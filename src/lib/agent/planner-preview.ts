import 'server-only';

import { AppError } from '@/lib/errors';
import { createLlmClient } from '@/lib/llm/config';
import { getEnabledCapabilities } from '@/lib/registry';
import { listSkills } from '@/lib/registry/skills';
import { listTools } from '@/lib/registry/tools';
import type {
  PlannerOverviewResponse,
  PlannerPreviewRequest,
  PlannerPreviewResponse,
} from '@/lib/types';
import { detectInputSignals, normalizeMandatoryCapabilities } from './signals';
import {
  buildPlannerMessages,
  PLANNER_VERSION,
  runPlanner,
} from './planner';
import { getPlannerConfig } from './planner-config';
import { applyPlannerRules } from './planner-rules';
import { validatePlan } from './validator';

export async function getPlannerOverview(): Promise<PlannerOverviewResponse> {
  const [config, skills, tools, enabled] = await Promise.all([
    getPlannerConfig(),
    listSkills(),
    listTools(),
    getEnabledCapabilities(),
  ]);
  const prompt = buildPlannerMessages({
    userInput: '{{userInput}}',
    conversationHistory: [],
    availableSkills: enabled.skills,
    availableTools: enabled.tools,
    mandatoryCapabilities: [],
    signals: detectInputSignals(''),
    systemPromptTemplate: config.systemPrompt,
  })[0].content;

  return {
    config,
    plannerVersion: PLANNER_VERSION,
    prompt,
    skills,
    tools,
    generatedAt: new Date().toISOString(),
  };
}

function subsetOrAll<T extends { id: string; enabled: boolean }>(
  items: T[],
  requestedIds: string[] | undefined,
  label: string,
): T[] {
  if (requestedIds === undefined) return items;
  const unknown = requestedIds.filter((id) => !items.some((item) => item.id === id));
  if (unknown.length > 0) {
    throw new AppError(
      422,
      'PREVIEW_CAPABILITY_UNAVAILABLE',
      `预览选择的${label}不存在或已停用：${unknown.join('、')}`,
      { type: label, ids: unknown },
    );
  }
  const requested = new Set(requestedIds);
  return items.filter((item) => requested.has(item.id));
}

export async function previewPlanner(
  input: PlannerPreviewRequest,
): Promise<PlannerPreviewResponse> {
  const startedAt = Date.now();
  const [enabled, provider, plannerConfig] = await Promise.all([
    getEnabledCapabilities(),
    createLlmClient(input.provider ?? 'auto'),
    getPlannerConfig(),
  ]);

  const signals = detectInputSignals(input.userInput);
  const allowedToolIds = new Set([
    ...plannerConfig.baseTools,
    ...plannerConfig.priceTools,
  ]);
  const scopedTools = enabled.tools.filter((tool) => allowedToolIds.has(tool.id));
  const availableSkills = subsetOrAll(enabled.skills, input.skillIds, 'Skill');
  const availableTools = subsetOrAll(scopedTools, input.toolIds, 'Tool');
  const userMandatory = normalizeMandatoryCapabilities(
    input.mandatoryCapabilities ?? [],
    availableSkills.map((skill) => skill.id),
    availableTools.map((tool) => tool.id),
  );
  const plannerRules = applyPlannerRules({
    config: plannerConfig,
    tools: availableTools,
    mandatoryCapabilities: [...signals.requiredCapabilities, ...userMandatory],
    signals,
  });
  const mandatoryCapabilities = plannerRules.mandatoryCapabilities;

  const planner = await runPlanner({
    userInput: input.userInput,
    conversationHistory: input.conversationHistory ?? [],
    availableSkills,
    availableTools,
    mandatoryCapabilities,
    signals,
    provider,
  });
  const validation = validatePlan({
    plan: planner.plan,
    availableSkills,
    availableTools,
    mandatoryCapabilities,
    signals,
    parseError: planner.parseError,
  });

  return {
    plan: planner.plan,
    validation,
    parseError: planner.parseError,
    provider: planner.provider as PlannerPreviewResponse['provider'],
    model: planner.model,
    isDemo: planner.isDemo,
    mandatoryCapabilities,
    availableSkills: availableSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      requiredTools: skill.requiredTools,
    })),
    availableTools: availableTools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
    })),
    signals: {
      scenario: signals.scenario,
      flags: signals.risk.flags,
      riskLevel: signals.risk.level,
      requiresHumanHandoff: signals.risk.requiresHumanHandoff,
      requiredCapabilities: signals.requiredCapabilities,
    },
    plannerVersion: PLANNER_VERSION,
    durationMs: Date.now() - startedAt,
    generatedAt: new Date().toISOString(),
  };
}
