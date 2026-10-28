import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { explainRequestSchema } from '@/lib/agent/request-schemas';
import { getRun } from '@/lib/agent/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { runId } = await parseJsonBody(request, explainRequestSchema);
    const run = await getRun(runId);
    const toolSteps = run.steps.filter((step) => step.type === 'tool');
    const failedSteps = run.steps.filter((step) => step.status === 'ERROR');
    const riskViolations = run.riskResult?.violations ?? [];
    const evidence = [
      ...run.validation?.errors.map((issue) => `校验错误 ${issue.code}: ${issue.message}`) ?? [],
      ...toolSteps.map((step) => `${step.capabilityId}: ${step.status}${step.error ? ` · ${step.error}` : ''}`),
      ...failedSteps.map((step) => `${step.capabilityId} 失败：${step.error ?? '未知错误'}`),
      ...riskViolations.map((item) => `${item.ruleId} ${item.rule}: ${item.reason}`),
      ...(run.evaluation?.checks.map((check) => `${check.label}: ${check.status} · ${check.detail}`) ?? []),
    ];

    return jsonResponse({
      runId: run.id,
      summary:
        `${run.status} · ${run.provider}/${run.model} · 计划${run.plan ? '已生成' : '缺失'} · ` +
        `${run.steps.length} 个步骤 · ${run.riskResult?.decision ?? '无风险结果'}`,
      planReasoning: run.plan?.reasoning ?? '没有可解释的 Planner 计划。',
      riskExplanation: run.riskResult
        ? run.riskResult.decision === 'allow'
          ? `风险审核放行，等级 ${run.riskResult.riskLevel}。${run.riskResult.notes.join('；')}`
          : `风险审核阻断，等级 ${run.riskResult.riskLevel}。${run.riskResult.violations.map((item) => `${item.ruleId} ${item.reason}`).join('；')}`
        : '没有风险审核结果。',
      evidence,
      suggestions:
        run.status === '转人工' || run.status === '失败'
          ? ['人工核对失败步骤和订单证据', '确认 Provider 配置与必需能力是否启用', '必要时使用隔离环境重试']
          : ['如需复核，可重试运行并对比 Trace', '对风险边界样本补充人工标注'],
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
