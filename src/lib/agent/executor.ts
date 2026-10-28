import 'server-only';

import { AppError } from '@/lib/errors';
import { getTool, executeTool } from '@/lib/registry/tools';
import { getSkillDetail } from '@/lib/registry/skills';
import type {
  AgentEvaluation,
  AgentPlan,
  AgentStep,
  PlanValidation,
  RiskResult,
  Run,
  SkillVersionRef,
  ToolVersionRef,
} from '@/lib/schemas';
import type {
  AgentStreamEvent,
  ConversationMessage,
  SkillDetail,
  ToolSummary,
} from '@/lib/types';
import type { LlmClient } from '@/lib/llm/types';
import { evaluateAgentRun } from './evaluation';
import { runPlanner } from './planner';
import { blockedRiskResult, evaluateCandidateRisk, type ToolResultSnapshot } from './risk';
import type { InputSignals } from './signals';
import { deriveToolInput } from './tool-input';
import { updateRun } from './runs';
import { detectConversationEnd } from './session-end';
import { validatePlan, validationErrorText } from './validator';

const DEFAULT_SKILL_TIMEOUT_MS = 25_000;

function skillTimeoutMs(): number {
  const configured = Number(process.env.SKILL_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_SKILL_TIMEOUT_MS;
  return Math.min(120_000, Math.max(1_000, Math.round(configured)));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppError(
          504,
          'SKILL_TIMEOUT',
          `${label} 执行超过 ${timeoutMs}ms，已记录超时错误。`,
        ),
      );
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function errorDetails(error: unknown): { message: string; code: string } {
  if (error instanceof AppError) {
    return { message: error.message, code: error.code };
  }
  if (error instanceof Error) {
    return { message: error.message || '未知执行错误', code: 'AGENT_EXECUTION_ERROR' };
  }
  return { message: '未知执行错误', code: 'AGENT_EXECUTION_ERROR' };
}

function extractReply(text: string): string {
  const trimmed = text.trim();
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { reply?: unknown };
    if (typeof parsed.reply === 'string' && parsed.reply.trim()) {
      return parsed.reply.trim();
    }
  } catch {
    // 非 JSON 文本也可以作为候选回复。
  }
  return trimmed;
}

function toolSummary(toolResults: ToolResultSnapshot[]): string {
  return toolResults
    .map(
      (result) =>
        `### ${result.toolId} (${result.status})\n${
          result.status === 'SUCCESS'
            ? JSON.stringify(result.output ?? null).slice(0, 6000)
            : result.error ?? '工具执行失败'
        }`,
    )
    .join('\n\n');
}

function skillMessages(input: {
  skill: SkillDetail;
  userInput: string;
  conversationHistory: ConversationMessage[];
  plan: AgentPlan;
  toolResults: ToolResultSnapshot[];
  previousSkills: { skillId: string; output: string }[];
  candidateReply?: string;
}) {
  const previous = input.previousSkills
    .map((skill) => `### ${skill.skillId}\n${skill.output.slice(0, 4000)}`)
    .join('\n\n');
  const history = input.conversationHistory
    .slice(-6)
    .map((message) => `${message.role === 'user' ? '用户' : '客服'}：${message.content}`)
    .join('\n');
  const user = `用户问题：${input.userInput}

最近对话：
${history || '无'}

Planner 计划：
${JSON.stringify(input.plan, null, 2)}

工具结果：
${toolSummary(input.toolResults) || '本次没有 Tool 结果'}

已执行 Skill：
${previous || '无'}

${input.candidateReply ? `待审核候选回复：\n${input.candidateReply}\n` : ''}

请严格遵循你的 Skill 定义，输出本步骤结果。若提示词要求 JSON，只输出 JSON，不要 Markdown 围栏。`;

  return [
    { role: 'system' as const, content: input.skill.systemPrompt },
    { role: 'user' as const, content: user },
  ];
}

function resolveSkillModel(skill: SkillDetail, provider: LlmClient): string {
  if (provider.info.isDemo) return provider.info.model;
  if (skill.model === 'snackops-fixture-v1' || !skill.model.trim()) return provider.info.model;
  return skill.model;
}

export type AgentExecutionInput = {
  run: Run;
  userInput: string;
  conversationHistory: ConversationMessage[];
  mandatoryCapabilities: string[];
  signals: InputSignals;
  availableSkills: SkillDetail[];
  availableTools: ToolSummary[];
  provider: LlmClient;
  onEvent: (event: AgentStreamEvent) => void;
};

export async function executeAgentRun(input: AgentExecutionInput): Promise<Run> {
  const startedAt = Date.now();
  let run = input.run;
  let steps: AgentStep[] = [];
  let plan: AgentPlan | null = null;
  let validation: PlanValidation | null = null;
  let riskResult: RiskResult | null = null;
  let finalReply: string | null = null;
  let error: string | null = null;
  let errorCode: string | null = null;
  let status: Run['status'] = '运行中';
  let skillVersions: SkillVersionRef[] = [];
  let toolVersions: ToolVersionRef[] = [];

  const emit = (event: AgentStreamEvent) => {
    try {
      input.onEvent(event);
    } catch {
      // 客户端断开不应中断服务端持久化和风险评估。
    }
  };

  const persist = async (patch: Partial<Run>): Promise<Run> => {
    run = await updateRun(run.id, (current) => ({
      ...current,
      ...patch,
      steps,
      skillVersions,
      toolVersions,
      durationMs: Date.now() - startedAt,
    }));
    return run;
  };

  const addSkillVersion = (skill: SkillDetail) => {
    if (!skillVersions.some((item) => item.skillId === skill.id && item.version === skill.version)) {
      skillVersions = [
        ...skillVersions,
        { skillId: skill.id, version: skill.version, hash: skill.hash },
      ];
    }
  };

  const addToolVersion = (tool: ToolSummary) => {
    if (!toolVersions.some((item) => item.toolId === tool.id && item.version === tool.version)) {
      toolVersions = [
        ...toolVersions,
        { toolId: tool.id, version: tool.version },
      ];
    }
  };

  const appendStep = async (step: AgentStep) => {
    steps = [...steps, step];
    await persist({});
    emit({ type: 'step', step });
  };

  const complete = async (): Promise<Run> => {
    if (!riskResult) {
      riskResult = blockedRiskResult({
        signals: input.signals,
        reason: error ?? '没有生成风险审核结果，按安全策略阻断。',
        ruleId: 'R00',
      });
    }
    if (!finalReply) {
      finalReply = riskResult.safeReply ?? '这个问题需要人工进一步核实，已为你转接客服。';
    }
    const evaluation: AgentEvaluation = evaluateAgentRun({
      plan,
      validation,
      steps,
      riskResult,
      finalReply,
      status,
    });
    const conversationEnded = detectConversationEnd({
      userInput: input.userInput,
      finalReply,
      status,
    });
    run = await persist({
      status,
      finalReply,
      riskResult,
      evaluation,
      error,
      errorCode,
      conversationEnded,
    });
    if (error) {
      emit({ type: 'error', error, code: errorCode ?? 'AGENT_ERROR', run });
    }
    emit({
      type: 'final',
      finalReply,
      riskResult,
      evaluation,
      status,
      conversationEnded,
    });
    return run;
  };

  const runSkill = async (params: {
    skill: SkillDetail;
    previousSkills: { skillId: string; output: string }[];
    toolResults: ToolResultSnapshot[];
    candidateReply?: string;
    purpose: 'skill';
  }): Promise<{ step: AgentStep; output: string | null; error: string | null }> => {
    const start = Date.now();
    const startedIso = new Date(start).toISOString();
    let output: string | null = null;

    try {
      const freshlyLoaded = await getSkillDetail(params.skill.id);
      if (!freshlyLoaded.enabled) {
        throw new AppError(409, 'SKILL_DISABLED', `Skill ${params.skill.id} 已停用，不能继续执行`);
      }
      addSkillVersion(freshlyLoaded);
      const model = resolveSkillModel(freshlyLoaded, input.provider);
      const generation = await withTimeout(
        input.provider.generate({
          messages: skillMessages({
            skill: freshlyLoaded,
            userInput: input.userInput,
            conversationHistory: input.conversationHistory,
            plan: plan!,
            toolResults: params.toolResults,
            previousSkills: params.previousSkills,
            candidateReply: params.candidateReply,
          }),
          temperature: freshlyLoaded.temperature,
          maxTokens: freshlyLoaded.maxTokens,
          json: freshlyLoaded.id === 'response-generator',
          model,
          purpose: 'skill',
          fixture: {
            task: 'skill',
            userInput: input.userInput,
            conversationHistory: input.conversationHistory,
            mandatoryCapabilities: input.mandatoryCapabilities,
            signals: input.signals,
            availableSkills: input.availableSkills.map((skill) => ({
              id: skill.id,
              name: skill.name,
              description: skill.description,
            })),
            availableTools: input.availableTools.map((tool) => ({
              id: tool.id,
              name: tool.name,
              description: tool.description,
            })),
            skillId: freshlyLoaded.id,
            skillName: freshlyLoaded.name,
            plan: plan!,
            toolResults: params.toolResults,
            previousSkills: params.previousSkills,
            candidateReply: params.candidateReply,
          },
        }),
        skillTimeoutMs(),
        `Skill ${freshlyLoaded.name}`,
      );
      output = generation.text;
      addSkillVersion(freshlyLoaded);

      const step: AgentStep = {
        id: `step-${steps.length + 1}`,
        index: steps.length,
        type: 'skill',
        capabilityId: freshlyLoaded.id,
        title: freshlyLoaded.name,
        input: {
          userInput: input.userInput,
          planGoal: plan?.goal ?? null,
          toolResultIds: params.toolResults.map((result) => result.toolId),
          candidateIncluded: Boolean(params.candidateReply),
        },
        output,
        durationMs: Date.now() - start,
        status: 'SUCCESS',
        error: null,
        startedAt: startedIso,
        finishedAt: new Date().toISOString(),
        provider: generation.provider,
        model: generation.model,
        version: freshlyLoaded.version,
        hash: freshlyLoaded.hash,
      };
      await appendStep(step);
      return { step, output, error: null };
    } catch (caught) {
      const details = errorDetails(caught);
      addSkillVersion(params.skill);
      const step: AgentStep = {
        id: `step-${steps.length + 1}`,
        index: steps.length,
        type: 'skill',
        capabilityId: params.skill.id,
        title: params.skill.name,
        input: {
          userInput: input.userInput,
          planGoal: plan?.goal ?? null,
          toolResultIds: params.toolResults.map((result) => result.toolId),
        },
        output: null,
        durationMs: Date.now() - start,
        status: 'ERROR',
        error: `${details.code}: ${details.message}`,
        startedAt: startedIso,
        finishedAt: new Date().toISOString(),
        version: params.skill.version,
        hash: params.skill.hash,
      };
      await appendStep(step);
      return { step, output: null, error: details.message };
    }
  };

  try {
    const plannerResult = await runPlanner({
      userInput: input.userInput,
      conversationHistory: input.conversationHistory,
      availableSkills: input.availableSkills,
      availableTools: input.availableTools,
      mandatoryCapabilities: input.mandatoryCapabilities,
      signals: input.signals,
      provider: input.provider,
    });

    plan = plannerResult.plan;
    validation = validatePlan({
      plan,
      availableSkills: input.availableSkills,
      availableTools: input.availableTools,
      mandatoryCapabilities: input.mandatoryCapabilities,
      signals: input.signals,
      parseError: plannerResult.parseError,
    });

    await persist({
      plan,
      validation,
      provider: plannerResult.provider as Run['provider'],
      model: plannerResult.model,
      isDemo: plannerResult.isDemo,
    });
    emit({
      type: 'plan',
      plan,
      validation,
      provider: plannerResult.provider as Run['provider'],
      model: plannerResult.model,
      isDemo: plannerResult.isDemo,
    });

    if (!validation.valid || plan.fallback?.required) {
      status = '转人工';
      errorCode = 'PLAN_VALIDATION_FAILED';
      error =
        validationErrorText(validation) ||
        plan.fallback?.reason ||
        'Plan 未通过安全校验，已降级为人工处理。';
      riskResult = blockedRiskResult({
        signals: input.signals,
        reason: error,
        ruleId: 'PLAN',
      });
      finalReply = riskResult.safeReply;
      return await complete();
    }

    const selectedSkills = new Set(plan.selectedSkills);
    const selectedTools = new Set(plan.selectedTools);
    const availableById = new Map(input.availableSkills.map((skill) => [skill.id, skill]));
    const previousSkills: { skillId: string; output: string }[] = [];
    const toolResults: ToolResultSnapshot[] = [];
    let candidateReply: string | null = null;
    const stepErrors: string[] = [];

    if (selectedSkills.has('need-extraction')) {
      const skill = availableById.get('need-extraction');
      if (skill) {
        const result = await runSkill({
          skill,
          previousSkills,
          toolResults,
          purpose: 'skill',
        });
        if (result.output) previousSkills.push({ skillId: skill.id, output: result.output });
        if (result.error) stepErrors.push(`need-extraction: ${result.error}`);
      }
    }

    const toolOrder = [
      'query_products',
      'query_activities',
      'query_coupons',
      'query_orders',
      'query_logistics',
      'calculate_price',
    ];
    const orderedTools = [...selectedTools].sort((left, right) => {
      const leftIndex = toolOrder.indexOf(left);
      const rightIndex = toolOrder.indexOf(right);
      return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
    });

    for (const toolId of orderedTools) {
      const start = Date.now();
      const startedIso = new Date(start).toISOString();
      const tool = await getTool(toolId);
      addToolVersion(tool);
      const derived = await deriveToolInput({
        toolId,
        signals: input.signals,
        toolResults,
      });

      if (derived.error) {
        const step: AgentStep = {
          id: `step-${steps.length + 1}`,
          index: steps.length,
          type: 'tool',
          capabilityId: toolId,
          title: tool.name,
          input: derived.input,
          output: null,
          durationMs: Date.now() - start,
          status: 'ERROR',
          error: derived.error,
          startedAt: startedIso,
          finishedAt: new Date().toISOString(),
          version: tool.version,
        };
        toolResults.push({ toolId, status: 'ERROR', input: derived.input, error: derived.error });
        stepErrors.push(`${toolId}: ${derived.error}`);
        await appendStep(step);
        continue;
      }

      if (!tool.enabled) {
        const message = `工具 ${tool.name} 已停用，不能执行`;
        const step: AgentStep = {
          id: `step-${steps.length + 1}`,
          index: steps.length,
          type: 'tool',
          capabilityId: toolId,
          title: tool.name,
          input: derived.input,
          output: null,
          durationMs: Date.now() - start,
          status: 'ERROR',
          error: message,
          startedAt: startedIso,
          finishedAt: new Date().toISOString(),
          version: tool.version,
        };
        toolResults.push({ toolId, status: 'ERROR', input: derived.input, error: message });
        stepErrors.push(`${toolId}: ${message}`);
        await appendStep(step);
        continue;
      }

      try {
        const execution = await executeTool(toolId, derived.input);
        toolResults.push({
          toolId,
          status: 'SUCCESS',
          input: derived.input,
          output: execution.output,
        });
        const step: AgentStep = {
          id: `step-${steps.length + 1}`,
          index: steps.length,
          type: 'tool',
          capabilityId: toolId,
          title: tool.name,
          input: derived.input,
          output: execution.output,
          durationMs: Date.now() - start,
          status: 'SUCCESS',
          error: null,
          startedAt: startedIso,
          finishedAt: new Date().toISOString(),
          version: tool.version,
        };
        await appendStep(step);
      } catch (caught) {
        const details = errorDetails(caught);
        toolResults.push({
          toolId,
          status: 'ERROR',
          input: derived.input,
          error: details.message,
        });
        stepErrors.push(`${toolId}: ${details.message}`);
        const step: AgentStep = {
          id: `step-${steps.length + 1}`,
          index: steps.length,
          type: 'tool',
          capabilityId: toolId,
          title: tool.name,
          input: derived.input,
          output: null,
          durationMs: Date.now() - start,
          status: 'ERROR',
          error: `${details.code}: ${details.message}`,
          startedAt: startedIso,
          finishedAt: new Date().toISOString(),
          version: tool.version,
        };
        await appendStep(step);
      }
    }

    const middleSkills = plan.selectedSkills.filter(
      (skillId) =>
        skillId !== 'need-extraction' &&
        skillId !== 'response-generator' &&
        skillId !== 'risk-check',
    );
    for (const skillId of middleSkills) {
      const skill = availableById.get(skillId);
      if (!skill) continue;
      const result = await runSkill({
        skill,
        previousSkills,
        toolResults,
        purpose: 'skill',
      });
      if (result.output) previousSkills.push({ skillId: skill.id, output: result.output });
      if (result.error) stepErrors.push(`${skillId}: ${result.error}`);
    }

    const responseSkill = availableById.get('response-generator');
    if (!responseSkill) {
      throw new AppError(500, 'RESPONSE_SKILL_MISSING', '缺少 response-generator 能力');
    }
    const responseResult = await runSkill({
      skill: responseSkill,
      previousSkills,
      toolResults,
      purpose: 'skill',
    });
    if (responseResult.output) {
      previousSkills.push({ skillId: responseSkill.id, output: responseResult.output });
      candidateReply = extractReply(responseResult.output);
    }
    if (responseResult.error) stepErrors.push(`response-generator: ${responseResult.error}`);

    if (!candidateReply) {
      candidateReply =
        '这次处理没有生成可靠的候选回复，我不会把未确认信息发送给你。建议转人工进一步核实。';
    }

    const riskSkill = await getSkillDetail('risk-check');
    if (!riskSkill.enabled) {
      throw new AppError(409, 'RISK_SKILL_DISABLED', 'risk-check 已停用，不能发送候选回复');
    }
    addSkillVersion(riskSkill);
    riskResult = evaluateCandidateRisk({
      signals: input.signals,
      candidateReply,
      toolResults,
    });
    const riskStep: AgentStep = {
      id: `step-${steps.length + 1}`,
      index: steps.length,
      type: 'skill',
      capabilityId: 'risk-check',
      title: riskSkill.name,
      input: {
        candidateReply,
        toolIds: toolResults.map((result) => result.toolId),
        flags: input.signals.risk.flags,
      },
      output: riskResult,
      durationMs: 1,
      status: 'SUCCESS',
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      provider: 'rules-engine',
      model: 'risk-check.rules.v1',
      version: riskSkill.version,
      hash: riskSkill.hash,
    };
    await appendStep(riskStep);

    if (stepErrors.length > 0) {
      status = '失败';
      errorCode = 'EXECUTION_ERROR';
      error = stepErrors.join('；');
    } else if (riskResult.decision === 'block' || riskResult.handoffRequired) {
      status = '转人工';
      errorCode = riskResult.decision === 'block' ? 'RISK_BLOCKED' : null;
      error =
        riskResult.decision === 'block'
          ? `风险审核阻断：${riskResult.violations.map((item) => item.ruleId).join('、')}`
          : null;
    } else {
      status = '成功';
    }

    finalReply =
      riskResult.decision === 'block'
        ? riskResult.safeReply ?? candidateReply
        : candidateReply;

    return await complete();
  } catch (caught) {
    const details = errorDetails(caught);
    status = '失败';
    error = details.message;
    errorCode = details.code;
    riskResult = blockedRiskResult({
      signals: input.signals,
      reason: `${details.code}: ${details.message}`,
      ruleId: 'EXECUTION',
    });
    finalReply = riskResult.safeReply;
    return await complete();
  }
}
