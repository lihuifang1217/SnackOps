import type {
  AgentPlan,
  PlanIssue,
  PlanValidation,
  SkillDetail,
  ToolSummary,
} from '@/lib/types';
import type { InputSignals } from './signals';

type CapabilityRef = { type: 'skill' | 'tool'; id: string };

function parseCapability(value: string): CapabilityRef | null {
  if (value.startsWith('skill:') && value.length > 6) {
    return { type: 'skill', id: value.slice(6) };
  }
  if (value.startsWith('tool:') && value.length > 5) {
    return { type: 'tool', id: value.slice(5) };
  }
  return null;
}

function issue(code: string, message: string): PlanIssue {
  return { code, message };
}

export function validatePlan(input: {
  plan: AgentPlan;
  availableSkills: SkillDetail[];
  availableTools: ToolSummary[];
  mandatoryCapabilities: string[];
  signals: InputSignals;
  parseError: string | null;
}): PlanValidation {
  const errors: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const skillIds = new Set(input.availableSkills.map((skill) => skill.id));
  const toolIds = new Set(input.availableTools.map((tool) => tool.id));
  const selectedSkills = new Set(input.plan.selectedSkills);
  const selectedTools = new Set(input.plan.selectedTools);

  if (input.parseError) {
    errors.push(issue('PLAN_PARSE_FAILED', input.parseError));
  }

  for (const skillId of input.plan.selectedSkills) {
    if (!skillIds.has(skillId)) {
      errors.push(
        issue(
          'UNKNOWN_OR_DISABLED_SKILL',
          `Plan 选择了不存在或未启用的 Skill：${skillId}`,
        ),
      );
    }
  }
  for (const toolId of input.plan.selectedTools) {
    if (!toolIds.has(toolId)) {
      errors.push(
        issue('UNKNOWN_OR_DISABLED_TOOL', `Plan 选择了不存在或未启用的 Tool：${toolId}`),
      );
    }
  }

  const mandatory = new Set([
    ...input.mandatoryCapabilities,
    ...input.plan.mandatoryCapabilities,
  ]);
  for (const capability of mandatory) {
    const ref = parseCapability(capability);
    if (!ref) {
      errors.push(issue('INVALID_MANDATORY_CAPABILITY', `无法识别强制能力格式：${capability}`));
      continue;
    }
    if (ref.type === 'skill') {
      if (!skillIds.has(ref.id)) {
        errors.push(
          issue('CAPABILITY_UNAVAILABLE', `强制 Skill 不存在或未启用：${ref.id}`),
        );
      }
      if (!selectedSkills.has(ref.id)) {
        errors.push(
          issue('MANDATORY_SKILL_MISSING', `Plan 遗漏强制 Skill：${ref.id}`),
        );
      }
    } else {
      if (!toolIds.has(ref.id)) {
        errors.push(
          issue('CAPABILITY_UNAVAILABLE', `强制 Tool 不存在或未启用：${ref.id}`),
        );
      }
      if (!selectedTools.has(ref.id)) {
        errors.push(issue('MANDATORY_TOOL_MISSING', `Plan 遗漏强制 Tool：${ref.id}`));
      }
    }
  }

  if (input.signals.price && !selectedTools.has('calculate_price')) {
    errors.push(
      issue('MISSING_PRICE_TOOL', '价格场景缺少 calculate_price，禁止继续生成价格回复。'),
    );
  }
  if (input.signals.order && !selectedTools.has('query_orders')) {
    errors.push(issue('MISSING_ORDER_TOOL', '订单场景缺少 query_orders。'));
  }
  if (input.signals.logistics && !selectedTools.has('query_logistics')) {
    errors.push(issue('MISSING_LOGISTICS_TOOL', '物流场景缺少 query_logistics。'));
  }
  if (
    (input.signals.risk.flags.length > 0 || input.signals.risk.requiresHumanHandoff) &&
    !selectedSkills.has('risk-check')
  ) {
    errors.push(
      issue('MISSING_RISK_CHECK', '风险场景缺少 risk-check，已阻断执行或降级为人工。'),
    );
  }
  if (
    input.signals.risk.requiresHumanHandoff &&
    !selectedSkills.has('human-handoff-decision')
  ) {
    errors.push(
      issue('MISSING_HANDOFF_SKILL', '高风险场景缺少 human-handoff-decision。'),
    );
  }

  if (input.signals.risk.level === 'high' && !input.plan.risk.requiresHumanHandoff) {
    warnings.push(
      issue('RISK_UNDERESTIMATED', '确定性风险判断为 high，但 Plan 未要求人工接管。'),
    );
  }
  if (input.plan.fallback?.required) {
    warnings.push(
      issue('PLANNER_FALLBACK', input.plan.fallback.reason || 'Planner 声明需要降级。'),
    );
  }
  if (new Set(input.plan.selectedSkills).size !== input.plan.selectedSkills.length) {
    warnings.push(issue('DUPLICATE_SKILLS', 'Plan 中存在重复 Skill。'));
  }
  if (new Set(input.plan.selectedTools).size !== input.plan.selectedTools.length) {
    warnings.push(issue('DUPLICATE_TOOLS', 'Plan 中存在重复 Tool。'));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

export function validationErrorText(validation: PlanValidation): string {
  return validation.errors.map((item) => `${item.code}: ${item.message}`).join('；');
}
