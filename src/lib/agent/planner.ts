import 'server-only';

import { z } from 'zod';
import type { AgentPlan, SkillDetail, ToolSummary } from '@/lib/types';
import type { ConversationMessage } from '@/lib/types';
import type { LlmClient } from '@/lib/llm/types';
import type { InputSignals } from './signals';
import { getPlannerConfig } from './planner-config';

export const PLANNER_VERSION = 'planner.v2.1';

const planRiskSchema = z.object({
  level: z.enum(['none', 'low', 'medium', 'high']),
  flags: z.array(z.string()),
  requiresHumanHandoff: z.boolean(),
  notes: z.array(z.string()),
});

const planSchema = z.object({
  goal: z.string().min(1),
  selectedSkills: z.array(z.string()),
  selectedTools: z.array(z.string()),
  reasoning: z.string(),
  mandatoryCapabilities: z.array(z.string()),
  risk: planRiskSchema,
  fallback: z
    .object({
      required: z.boolean(),
      reason: z.string(),
    })
    .nullable(),
});

export type PlannerResult = {
  plan: AgentPlan;
  rawOutput: string;
  parseError: string | null;
  provider: string;
  model: string;
  isDemo: boolean;
};

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(withoutFence.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * 真实模型经常把 Planner Prompt 中的 `skill:` / `tool:` 前缀带进
 * selectedSkills / selectedTools。协议要求这两个字段使用裸 ID；
 * 在进入 Validator 前统一归一化，避免误报“不存在或未启用”。
 */
export function normalizePlannerPlan(plan: AgentPlan): AgentPlan {
  const selectedSkills = unique(
    plan.selectedSkills.map((value) =>
      value.trim().replace(/^skill:/, ''),
    ),
  );
  const selectedTools = unique(
    plan.selectedTools.map((value) =>
      value.trim().replace(/^tool:/, ''),
    ),
  );
  const mandatoryCapabilities = unique(
    plan.mandatoryCapabilities.map((value) => {
      const trimmed = value.trim();
      if (trimmed.startsWith('skill:') || trimmed.startsWith('tool:')) return trimmed;
      // 兼容模型把 mandatoryCapabilities 写成裸 ID 的情况。
      if (selectedSkills.includes(trimmed)) return `skill:${trimmed}`;
      if (selectedTools.includes(trimmed)) return `tool:${trimmed}`;
      return trimmed;
    }),
  );
  return {
    ...plan,
    selectedSkills,
    selectedTools,
    mandatoryCapabilities,
  };
}

function fallbackPlan(input: {
  signals: InputSignals;
  mandatoryCapabilities: string[];
  availableSkills: SkillDetail[];
  availableTools: ToolSummary[];
  reason: string;
}): AgentPlan {
  const skillIds = new Set(input.availableSkills.map((skill) => skill.id));
  const toolIds = new Set(input.availableTools.map((tool) => tool.id));
  const selectedSkills: string[] = [];
  const selectedTools: string[] = [];

  for (const capability of input.mandatoryCapabilities) {
    if (capability.startsWith('skill:') && skillIds.has(capability.slice(6))) {
      if (!selectedSkills.includes(capability.slice(6))) selectedSkills.push(capability.slice(6));
    }
    if (capability.startsWith('tool:') && toolIds.has(capability.slice(5))) {
      if (!selectedTools.includes(capability.slice(5))) selectedTools.push(capability.slice(5));
    }
  }

  return {
    goal: 'Planner 输出无法安全解析，降级为人工处理',
    selectedSkills,
    selectedTools,
    reasoning: input.reason,
    mandatoryCapabilities: input.mandatoryCapabilities,
    risk: {
      ...input.signals.risk,
      requiresHumanHandoff: true,
      notes: [...input.signals.risk.notes, input.reason],
    },
    fallback: {
      required: true,
      reason: input.reason,
    },
  };
}

export function buildPlannerMessages(input: {
  userInput: string;
  conversationHistory: ConversationMessage[];
  availableSkills: SkillDetail[];
  availableTools: ToolSummary[];
  mandatoryCapabilities: string[];
  signals: InputSignals;
  systemPromptTemplate: string;
}) {
  const skills = input.availableSkills
    .map(
      (skill) =>
        `- skill:${skill.id} | 名称：${skill.name} | 分类：${skill.category} | 依赖：${skill.requiredTools.join(',') || '无'} | ${skill.description}`,
    )
    .join('\n');
  const tools = input.availableTools
    .map((tool) => `- tool:${tool.id} | 名称：${tool.name} | ${tool.description}`)
    .join('\n');
  const history = input.conversationHistory
    .slice(-8)
    .map((message) => `${message.role === 'user' ? '用户' : '客服'}：${message.content}`)
    .join('\n');

  const system = input.systemPromptTemplate
    .replaceAll('{{availableSkills}}', skills || '无')
    .replaceAll('{{availableTools}}', tools || '无')
    .replaceAll('{{mandatoryCapabilities}}', input.mandatoryCapabilities.join(', ') || '无')
    .replaceAll('{{riskSignals}}', JSON.stringify(input.signals.risk))
    .replaceAll('{{userInput}}', input.userInput)
    .replaceAll('{{conversationHistory}}', history || '无');

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: input.userInput },
  ];
}

export async function runPlanner(input: {
  userInput: string;
  conversationHistory: ConversationMessage[];
  availableSkills: SkillDetail[];
  availableTools: ToolSummary[];
  mandatoryCapabilities: string[];
  signals: InputSignals;
  provider: LlmClient;
}): Promise<PlannerResult> {
  const plannerConfig = await getPlannerConfig();
  const generation = await input.provider.generate({
    messages: buildPlannerMessages({
      ...input,
      systemPromptTemplate: plannerConfig.systemPrompt,
    }),
    temperature: plannerConfig.temperature,
    maxTokens: plannerConfig.maxTokens,
    ...(plannerConfig.model && plannerConfig.model !== 'provider-default'
      ? { model: plannerConfig.model }
      : {}),
    json: true,
    purpose: 'planner',
    fixture: {
      task: 'planner',
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
    },
  });

  const parsed = extractJson(generation.text);
  if (!parsed) {
    const reason = 'Planner 输出不是有效 JSON，已触发安全 fallback，不会绕过校验继续执行。';
    return {
      plan: fallbackPlan({ ...input, reason }),
      rawOutput: generation.text,
      parseError: reason,
      provider: generation.provider,
      model: generation.model,
      isDemo: generation.isDemo,
    };
  }

  const result = planSchema.safeParse(parsed);
  if (!result.success) {
    const reason = `Planner JSON 未通过结构校验：${result.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .slice(0, 4)
      .join('；')}`;
    return {
      plan: fallbackPlan({ ...input, reason }),
      rawOutput: generation.text,
      parseError: reason,
      provider: generation.provider,
      model: generation.model,
      isDemo: generation.isDemo,
    };
  }

  return {
    plan: normalizePlannerPlan(result.data),
    rawOutput: generation.text,
    parseError: null,
    provider: generation.provider,
    model: generation.model,
    isDemo: generation.isDemo,
  };
}
