'use client';

import { Badge } from '@/components/ui/badge';
import type { AgentPlan, PlanValidation } from '@/lib/types';

type TimelineStep = {
  title: string;
  description: string;
};

const TOOL_ORDER = [
  'query_products',
  'query_activities',
  'query_coupons',
  'query_orders',
  'query_logistics',
  'calculate_price',
];

export function PlanProcessTimeline({
  plan,
  validation,
  mandatoryCapabilities,
  availableSkillsCount,
  availableToolsCount,
}: {
  plan: AgentPlan;
  validation: PlanValidation | null;
  mandatoryCapabilities: string[];
  availableSkillsCount?: number;
  availableToolsCount?: number;
}) {
  const mandatory = new Set([
    ...mandatoryCapabilities,
    ...plan.mandatoryCapabilities,
  ]);
  const mandatorySkills = [...mandatory].filter((item) => item.startsWith('skill:')).length;
  const mandatoryTools = [...mandatory].filter((item) => item.startsWith('tool:')).length;
  const candidateCount = plan.selectedSkills.length + plan.selectedTools.length;
  const errors = validation?.errors.length ?? 0;
  const warnings = validation?.warnings.length ?? 0;
  const availableText =
    availableSkillsCount !== undefined && availableToolsCount !== undefined
      ? `当前有 ${availableSkillsCount} 个启用 Skill、${availableToolsCount} 个启用 Tool。`
      : `本次读取到 ${plan.selectedSkills.length} 个候选 Skill、${plan.selectedTools.length} 个候选 Tool。`;
  const steps: TimelineStep[] = [
    {
      title: '识别任务特征',
      description:
        plan.risk.flags.length > 0
          ? `检测到 ${plan.risk.flags.join('、')}，风险等级 ${plan.risk.level}。`
          : `未发现显式风险，按 ${plan.goal} 生成计划。`,
    },
    {
      title: '读取可用能力',
      description: availableText,
    },
    {
      title: '注入强制规则',
      description: `锁定 ${mandatorySkills} 个必经 Skill 和 ${mandatoryTools} 个规则 Tool；risk-check 固定为最后一步。`,
    },
    {
      title: '模型生成候选计划',
      description: `Planner 返回 ${candidateCount} 个候选步骤。`,
    },
    {
      title: '能力白名单校验',
      description: validation?.valid
        ? `接受 ${candidateCount} 个计划能力，校验通过，0 个错误。`
        : `发现 ${errors} 个错误、${warnings} 个提醒，计划不会直接执行。`,
    },
    {
      title: '组装最终计划',
      description: `形成 ${candidateCount} 个可执行步骤，并将 risk-check 置于末尾。`,
    },
  ];

  return (
    <div className="plan-process-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="agent-section-title">Planner 决策过程</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            从任务识别到白名单校验，再到最终计划组装。
          </p>
        </div>
        <Badge tone={validation?.valid ? 'success' : 'danger'}>
          {validation?.valid ? '允许执行' : '需要修正'}
        </Badge>
      </div>
      <ol className="plan-step-timeline mt-3">
        {steps.map((step, index) => (
          <li key={step.title} className="plan-step">
            <span className="plan-step-number" aria-hidden>
              {index + 1}
            </span>
            <div className="plan-step-body">
              <p className="plan-step-title">{step.title}</p>
              <p className="plan-step-description">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

type CapabilityStep = {
  id: string;
  type: 'skill' | 'tool';
  label: string;
  required: boolean;
};

export function orderedPlanCapabilities(
  plan: AgentPlan,
  mandatoryCapabilities: string[],
): CapabilityStep[] {
  const mandatory = new Set([
    ...mandatoryCapabilities,
    ...plan.mandatoryCapabilities,
  ]);
  const skills = new Set(plan.selectedSkills);
  const tools = new Set(plan.selectedTools);
  const entries: CapabilityStep[] = [];
  const push = (type: 'skill' | 'tool', id: string) => {
    if (entries.some((entry) => entry.type === type && entry.id === id)) return;
    const required = mandatory.has(`${type}:${id}`);
    entries.push({
      id,
      type,
      label: required
        ? type === 'skill'
          ? '必经 Skill'
          : '规则要求'
        : type === 'skill'
          ? '计划 Skill'
          : '计划 Tool',
      required,
    });
  };

  if (skills.has('need-extraction')) push('skill', 'need-extraction');
  for (const toolId of TOOL_ORDER) {
    if (tools.has(toolId)) push('tool', toolId);
  }
  for (const skillId of plan.selectedSkills) {
    if (
      skillId !== 'need-extraction' &&
      skillId !== 'response-generator' &&
      skillId !== 'risk-check'
    ) {
      push('skill', skillId);
    }
  }
  if (skills.has('response-generator')) push('skill', 'response-generator');
  if (skills.has('risk-check')) push('skill', 'risk-check');

  // 保留 Planner 返回但不在已知顺序中的能力，防止界面吞步骤。
  for (const skillId of plan.selectedSkills) push('skill', skillId);
  for (const toolId of plan.selectedTools) push('tool', toolId);

  return entries;
}

export function PlanCapabilityTimeline({
  plan,
  mandatoryCapabilities,
}: {
  plan: AgentPlan;
  mandatoryCapabilities: string[];
}) {
  const entries = orderedPlanCapabilities(plan, mandatoryCapabilities);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="agent-section-title">计划步骤</p>
        <Badge tone="neutral">{entries.length} 步</Badge>
      </div>
      {entries.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">计划中没有可执行能力。</p>
      ) : (
        <ol className="plan-capability-timeline mt-3">
          {entries.map((entry, index) => (
            <li key={`${entry.type}-${entry.id}`} className="plan-capability-step">
              <span className="plan-step-number" aria-hidden>
                {index + 1}
              </span>
              <div className="plan-step-body">
                <p className="plan-step-title break-all">{entry.id}</p>
                <p className="plan-step-description">{entry.label}</p>
              </div>
              <span className={`plan-type-badge plan-type-${entry.type}`}>{entry.type}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
