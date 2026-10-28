import type { PlannerConfig } from '@/lib/schemas';
import type { InputSignals } from './signals';

/**
 * Planner 配置的能力规则：
 * - requiredSkills 每次规划都必须出现在 Plan 中；
 * - baseTools + priceTools 是 Planner 可用的 Tool 白名单；
 * - 价格场景下 priceTools 还作为强制 Tool；
 * - risk-check 由 signals 的强制能力始终保留，不能被配置移除。
 */
export function applyPlannerRules(input: {
  config: PlannerConfig;
  tools: { id: string }[];
  mandatoryCapabilities: string[];
  signals: InputSignals;
}): {
  availableTools: { id: string }[];
  mandatoryCapabilities: string[];
  allowedToolIds: string[];
} {
  const allowedToolIds = [
    ...new Set([...input.config.baseTools, ...input.config.priceTools]),
  ];
  const availableTools = input.tools.filter((tool) =>
    allowedToolIds.includes(tool.id),
  );
  const configuredMandatory = [
    ...input.config.requiredSkills.map((skillId) => `skill:${skillId}`),
    ...(input.signals.price
      ? input.config.priceTools.map((toolId) => `tool:${toolId}`)
      : []),
  ];
  return {
    availableTools,
    allowedToolIds,
    mandatoryCapabilities: [
      ...new Set([
        ...input.mandatoryCapabilities,
        ...configuredMandatory,
        'skill:risk-check',
      ]),
    ],
  };
}
