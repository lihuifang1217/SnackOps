import type { AgentEvaluation, AgentPlan, AgentStep, PlanValidation, RiskResult } from '@/lib/schemas';

export function evaluateAgentRun(input: {
  plan: AgentPlan | null;
  validation: PlanValidation | null;
  steps: AgentStep[];
  riskResult: RiskResult | null;
  finalReply: string | null;
  status: string;
}): AgentEvaluation {
  const { plan, validation, steps, riskResult, finalReply, status } = input;
  const checks: AgentEvaluation['checks'] = [];
  const requiredToolIds = new Set<string>();
  const requiredSkillIds = new Set<string>();

  if (plan) {
    for (const capability of plan.mandatoryCapabilities) {
      if (capability.startsWith('tool:')) requiredToolIds.add(capability.slice(5));
      if (capability.startsWith('skill:')) requiredSkillIds.add(capability.slice(6));
    }
  }

  const missingRequiredTools = [...requiredToolIds].filter(
    (toolId) => !steps.some((step) => step.type === 'tool' && step.capabilityId === toolId && step.status === 'SUCCESS'),
  );
  const missingRequiredSkills = [...requiredSkillIds].filter(
    (skillId) => !steps.some((step) => step.type === 'skill' && step.capabilityId === skillId && step.status === 'SUCCESS'),
  );

  const planPass = Boolean(plan && validation?.valid && !plan.fallback?.required);
  checks.push({
    id: 'plan_valid',
    label: '计划与能力校验',
    status: planPass ? 'PASS' : 'FAIL',
    detail: planPass
      ? 'Planner 计划通过独立 Validator 校验。'
      : validation?.errors.map((issue) => issue.message).join('；') || '计划缺失或 fallback 被触发。',
  });

  const requiredPass = missingRequiredTools.length === 0 && missingRequiredSkills.length === 0;
  checks.push({
    id: 'mandatory_capabilities',
    label: '强制能力执行',
    status: requiredPass ? 'PASS' : 'FAIL',
    detail: requiredPass
      ? '全部 mandatoryCapabilities 已成功执行。'
      : `未成功执行：${[...missingRequiredSkills, ...missingRequiredTools].join('、')}`,
  });

  const stepErrors = steps.filter((step) => step.status === 'ERROR');
  checks.push({
    id: 'steps_successful',
    label: 'Skill / Tool 步骤',
    status: stepErrors.length === 0 ? 'PASS' : 'FAIL',
    detail:
      stepErrors.length === 0
        ? `${steps.length} 个步骤全部成功。`
        : `${stepErrors.length} 个步骤失败：${stepErrors.map((step) => step.capabilityId).join('、')}`,
  });

  const toolsExecuted = steps.filter((step) => step.type === 'tool' && step.status === 'SUCCESS').length;
  checks.push({
    id: 'tool_evidence',
    label: '工具证据',
    status: requiredToolIds.size === 0 || toolsExecuted > 0 ? 'PASS' : 'FAIL',
    detail:
      requiredToolIds.size === 0
        ? '该计划不要求工具调用。'
        : `已成功执行 ${toolsExecuted} 个 Tool，覆盖 ${[...requiredToolIds].length} 个强制工具。`,
  });

  const riskPass = Boolean(riskResult && riskResult.decision === 'allow');
  checks.push({
    id: 'risk_checked',
    label: '风险审核',
    status: riskResult ? (riskPass ? 'PASS' : 'WARN') : 'FAIL',
    detail: riskResult
      ? riskResult.decision === 'allow'
        ? `风险审核放行，风险等级 ${riskResult.riskLevel}。`
        : `风险审核阻断或要求人工接管：${riskResult.violations.map((item) => item.ruleId).join('、') || '高风险场景'}`
      : '没有风险审核结果。',
  });

  const replyPass = Boolean(finalReply?.trim());
  checks.push({
    id: 'final_reply',
    label: '最终回复',
    status: replyPass ? 'PASS' : 'FAIL',
    detail: replyPass ? `最终回复长度 ${finalReply?.length ?? 0} 字符。` : '没有最终回复。',
  });

  checks.push({
    id: 'run_status',
    label: '运行状态',
    status: status === '成功' ? 'PASS' : status === '转人工' ? 'WARN' : 'FAIL',
    detail: `运行结束状态：${status}。`,
  });

  const failures = checks.filter((check) => check.status === 'FAIL');
  const warnings = checks.filter((check) => check.status === 'WARN');
  const score = Math.round((checks.filter((check) => check.status === 'PASS').length / checks.length) * 100);

  return {
    score,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    checks,
    summary:
      failures.length === 0
        ? warnings.length === 0
          ? '计划、执行、风险审核和最终回复全部通过。'
          : `执行链路完成，但有 ${warnings.length} 项需要人工关注。`
        : `执行链路存在 ${failures.length} 项失败检查，不能视为成功。`,
  };
}
