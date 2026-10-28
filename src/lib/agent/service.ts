import 'server-only';

import { AppError } from '@/lib/errors';
import { getEnabledCapabilities } from '@/lib/registry';
import { createLlmClient } from '@/lib/llm/config';
import { getPlannerConfig } from './planner-config';
import { applyPlannerRules } from './planner-rules';
import type { LlmClient } from '@/lib/llm/types';
import type { AgentRunRequest } from '@/lib/types';
import type { Run } from '@/lib/schemas';
import type { AgentProviderSelection } from '@/lib/types';
import { executeAgentRun } from './executor';
import { createConversationId, createRun, createRunId, getRun } from './runs';
import { ensureTicketForRun } from '@/lib/tickets/service';
import {
  detectInputSignals,
  normalizeMandatoryCapabilities,
  type InputSignals,
} from './signals';

export type PreparedAgentRun = {
  run: Run;
  userInput: string;
  conversationHistory: NonNullable<AgentRunRequest['conversationHistory']>;
  mandatoryCapabilities: string[];
  signals: InputSignals;
  availableSkills: Awaited<ReturnType<typeof getEnabledCapabilities>>['skills'];
  availableTools: Awaited<ReturnType<typeof getEnabledCapabilities>>['tools'];
  provider: LlmClient;
};

export async function prepareAgentRun(input: {
  request: AgentRunRequest;
  source: 'workbench' | 'demo' | 'api' | 'retry';
  providerSelection?: AgentProviderSelection;
  retryOf?: string;
}): Promise<PreparedAgentRun> {
  const userInput = input.request.userInput.trim();
  if (!userInput) {
    throw new AppError(400, 'EMPTY_QUESTION', '用户问题不能为空');
  }

  const [provider, capabilities, plannerConfig] = await Promise.all([
    createLlmClient(input.providerSelection ?? input.request.provider),
    getEnabledCapabilities(),
    getPlannerConfig(),
  ]);
  const signals = detectInputSignals(userInput);
  const availableSkillIds = capabilities.skills.map((skill) => skill.id);
  const availableToolIds = capabilities.tools.map((tool) => tool.id);
  const userMandatory = normalizeMandatoryCapabilities(
    input.request.mandatoryCapabilities ?? [],
    availableSkillIds,
    availableToolIds,
  );
  const plannerRules = applyPlannerRules({
    config: plannerConfig,
    tools: capabilities.tools,
    mandatoryCapabilities: [...signals.requiredCapabilities, ...userMandatory],
    signals,
  });
  const mandatoryCapabilities = plannerRules.mandatoryCapabilities;
  const conversationHistory = input.request.conversationHistory ?? [];
  const now = new Date().toISOString();

  const run: Run = {
    id: createRunId(),
    question: userInput,
    source: input.source,
    conversationId: input.request.conversationId || createConversationId(),
    conversationHistory,
    ticketId: null,
    createdAt: now,
    status: '运行中',
    finalReply: null,
    plan: null,
    validation: null,
    steps: [],
    riskResult: null,
    durationMs: 0,
    error: null,
    errorCode: null,
    provider: provider.info.id,
    model: provider.info.model,
    isDemo: provider.info.isDemo,
    skillVersions: [],
    toolVersions: [],
    evaluation: null,
    handoff: null,
    retryOf: input.retryOf ?? null,
    conversationEnded: false,
  };

  await createRun(run);

  return {
    run,
    userInput,
    conversationHistory,
    mandatoryCapabilities,
    signals,
    availableSkills: capabilities.skills,
    availableTools: plannerRules.availableTools as typeof capabilities.tools,
    provider,
  };
}

export async function runPreparedAgent(
  prepared: PreparedAgentRun,
  onEvent: Parameters<typeof executeAgentRun>[0]['onEvent'] = () => undefined,
): Promise<Run> {
  const finalRun = await executeAgentRun({
    run: prepared.run,
    userInput: prepared.userInput,
    conversationHistory: prepared.conversationHistory,
    mandatoryCapabilities: prepared.mandatoryCapabilities,
    signals: prepared.signals,
    availableSkills: prepared.availableSkills,
    availableTools: prepared.availableTools,
    provider: prepared.provider,
    onEvent,
  });
  if (
    finalRun.status === '转人工' &&
    (finalRun.source === 'demo' || finalRun.source === 'workbench')
  ) {
    try {
      await ensureTicketForRun({ run: finalRun });
      return getRun(finalRun.id);
    } catch {
      // 工单失败不能吞掉已经完成的 Agent 运行；人工接管接口仍会再次确保工单。
    }
  }
  return finalRun;
}

export async function retryRun(input: {
  runId: string;
  provider?: AgentProviderSelection;
}): Promise<Run> {
  const original = await getRun(input.runId);
  const prepared = await prepareAgentRun({
    request: {
      userInput: original.question,
      conversationHistory: [],
      ...(input.provider ? { provider: input.provider } : {}),
      mandatoryCapabilities: [],
    },
    source: 'retry',
    providerSelection: input.provider ?? original.provider,
    retryOf: original.id,
  });
  return runPreparedAgent(prepared);
}
