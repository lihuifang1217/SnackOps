'use client';

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  ShieldAlert,
  Sparkles,
  RefreshCw,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  AgentEvaluation,
  AgentPlan,
  AgentStep,
  JsonSchema,
  PlanValidation,
  RiskResult,
  Run,
} from '@/lib/types';
import { formatDateTime } from '@/lib/client';
import { PlanCapabilityTimeline, PlanProcessTimeline } from './plan-timeline';

export function RunStatusBadge({ status }: { status: Run['status'] }) {
  if (status === '成功') return <Badge tone="success">成功</Badge>;
  if (status === '转人工') return <Badge tone="warning">转人工</Badge>;
  if (status === '失败') return <Badge tone="danger">失败</Badge>;
  return <Badge tone="accent">运行中</Badge>;
}

export function StepStatusBadge({ status }: { status: AgentStep['status'] }) {
  return status === 'SUCCESS' ? (
    <Badge tone="success">成功</Badge>
  ) : (
    <Badge tone="danger">错误</Badge>
  );
}

export function ProviderBadge({
  provider,
  model,
  isDemo,
}: {
  provider: string;
  model: string;
  isDemo: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={isDemo ? 'accent' : 'success'}>{isDemo ? '课堂演示' : '真实模型'}</Badge>
      <span className="font-mono text-[10px] text-muted-foreground">
        {provider} / {model}
      </span>
    </div>
  );
}

function Duration({ ms }: { ms: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <Clock3 className="size-3" aria-hidden />
      {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}
    </span>
  );
}

export function PlanPanel({
  plan,
  validation,
}: {
  plan: AgentPlan | null;
  validation: PlanValidation | null;
}) {
  if (!plan) {
    return (
      <section className="agent-section">
        <p className="agent-section-title">Planner 计划</p>
        <div className="empty-state min-h-[120px]">
          <CircleDashed className="size-5" aria-hidden />
          <p className="text-xs">尚未生成计划</p>
        </div>
      </section>
    );
  }

  return (
    <section className="agent-section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="agent-section-title">Planner 计划</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{plan.goal}</p>
        </div>
        <Badge tone={validation?.valid && !plan.fallback?.required ? 'success' : 'danger'}>
          {validation?.valid && !plan.fallback?.required ? '校验通过' : '校验未通过'}
        </Badge>
      </div>

      <div className="mt-3">
        <PlanProcessTimeline
          plan={plan}
          validation={validation}
          mandatoryCapabilities={plan.mandatoryCapabilities}
        />
        <PlanCapabilityTimeline
          plan={plan}
          mandatoryCapabilities={plan.mandatoryCapabilities}
        />
      </div>

      <div className="mt-3">
        <p className="agent-label">Planner 思考 / 决策过程</p>
        <p className="mt-1 text-[11px] leading-6 text-muted-foreground">{plan.reasoning}</p>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground">
          查看 Plan JSON
        </summary>
        <pre className="json-block mt-2">{JSON.stringify(plan, null, 2)}</pre>
      </details>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={plan.risk.level === 'high' ? 'danger' : plan.risk.level === 'medium' ? 'warning' : 'neutral'}>
          风险等级 {plan.risk.level}
        </Badge>
        {plan.risk.requiresHumanHandoff ? <Badge tone="warning">计划要求人工接管</Badge> : null}
        {plan.risk.flags.map((flag) => (
          <Badge tone="neutral" key={flag}>
            {flag}
          </Badge>
        ))}
      </div>

      {plan.fallback ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
          Fallback：{plan.fallback.reason || '未提供原因'} · {plan.fallback.required ? '阻止自动执行' : '仅提示'}
        </p>
      ) : null}

      {validation?.errors.length ? (
        <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-red-800">
            <XCircle className="size-3.5" aria-hidden />
            Plan Validator 错误
          </p>
          <ul className="mt-1.5 space-y-1">
            {validation.errors.map((issue) => (
              <li key={`${issue.code}-${issue.message}`} className="text-[10px] leading-5 text-red-800">
                <span className="font-mono">{issue.code}</span> · {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {validation?.warnings.length ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-900">
            <AlertTriangle className="size-3.5" aria-hidden />
            校验提醒
          </p>
          <ul className="mt-1.5 space-y-1">
            {validation.warnings.map((issue) => (
              <li key={`${issue.code}-${issue.message}`} className="text-[10px] leading-5 text-amber-900">
                <span className="font-mono">{issue.code}</span> · {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function StepsTimeline({
  steps,
  onRetryStep,
  retryingStepId,
}: {
  steps: AgentStep[];
  onRetryStep?: (step: AgentStep) => void;
  retryingStepId?: string | null;
}) {
  if (steps.length === 0) {
    return (
      <section className="agent-section">
        <p className="agent-section-title">执行 Trace</p>
        <div className="empty-state min-h-[120px]">
          <CircleDashed className="size-5" aria-hidden />
          <p className="text-xs">还没有执行步骤</p>
        </div>
      </section>
    );
  }

  return (
    <section className="agent-section">
      <p className="agent-section-title">执行 Trace</p>
      <ol className="agent-steps">
        {steps.map((step) => (
          <li key={step.id} className="agent-step">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className={`step-icon ${step.status === 'ERROR' ? 'step-icon-error' : ''}`}>
                  {step.type === 'tool' ? (
                    <Wrench className="size-3.5" aria-hidden />
                  ) : (
                    <Sparkles className="size-3.5" aria-hidden />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    {step.title}
                    <StepStatusBadge status={step.status} />
                  </p>
                  <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                    {step.type} · {step.capabilityId} · v{step.version ?? 'unversioned'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Duration ms={step.durationMs} />
                <span className="text-[10px] text-muted-foreground">{formatDateTime(step.finishedAt)}</span>
                {step.status === 'ERROR' && step.type === 'tool' && onRetryStep ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onRetryStep(step)}
                    disabled={retryingStepId === step.id}
                  >
                    {retryingStepId === step.id ? (
                      <RefreshCw className="size-3 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="size-3" aria-hidden />
                    )}
                    重试步骤
                  </Button>
                ) : null}
                {step.status === 'ERROR' && step.type === 'skill' ? (
                  <span className="text-[10px] text-muted-foreground">Skill 失败请重试整条运行</span>
                ) : null}
              </div>
            </div>

            {step.error ? (
              <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] leading-5 text-red-800">
                {step.error}
              </p>
            ) : null}

            <details className="mt-2">
              <summary className="flex cursor-pointer items-center gap-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground">
                <ChevronDown className="size-3" aria-hidden />
                查看输入 / 输出
              </summary>
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                <div>
                  <p className="agent-label">Input</p>
                  <pre className="json-block mt-1">{JSON.stringify(step.input, null, 2)}</pre>
                </div>
                <div>
                  <p className="agent-label">Output</p>
                  <pre className="json-block mt-1">{JSON.stringify(step.output, null, 2)}</pre>
                </div>
              </div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function RiskPanel({ riskResult }: { riskResult: RiskResult | null }) {
  if (!riskResult) {
    return (
      <section className="agent-section">
        <p className="agent-section-title">风险审核</p>
        <div className="empty-state min-h-[120px]">
          <ShieldAlert className="size-5" aria-hidden />
          <p className="text-xs">尚未生成风险结果</p>
        </div>
      </section>
    );
  }

  return (
    <section className="agent-section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="agent-section-title">风险审核</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            审计器：{riskResult.checkedBy}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={riskResult.decision === 'allow' ? 'success' : 'danger'}>
            {riskResult.decision === 'allow' ? '允许发送' : '阻断发送'}
          </Badge>
          <Badge tone={riskResult.riskLevel === 'high' ? 'danger' : riskResult.riskLevel === 'medium' ? 'warning' : 'neutral'}>
            风险 {riskResult.riskLevel}
          </Badge>
          {riskResult.handoffRequired ? <Badge tone="warning">建议人工接管</Badge> : null}
        </div>
      </div>

      {riskResult.flags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {riskResult.flags.map((flag) => (
            <Badge tone="neutral" key={flag}>
              {flag}
            </Badge>
          ))}
        </div>
      ) : null}

      {riskResult.violations.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {riskResult.violations.map((violation) => (
            <li
              key={`${violation.ruleId}-${violation.severity}-${violation.reason}`}
              className={`risk-violation ${
                violation.severity === 'blocking' ? 'risk-violation-blocking' : 'risk-violation-warning'
              }`}
            >
              <p className="text-[11px] font-semibold">
                {violation.ruleId} · {violation.rule}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {violation.severity === 'blocking' ? '阻断' : '提醒'}
                </span>
              </p>
              <p className="mt-1 text-[10px] leading-5">{violation.reason}</p>
              {violation.evidence ? (
                <p className="mt-1 break-words font-mono text-[9px] text-muted-foreground">
                  证据：{violation.evidence}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-800">
          <CheckCircle2 className="size-3.5" aria-hidden />
          未命中阻断规则，安全回复可以发送。
        </p>
      )}

      {riskResult.safeReply ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[10px] font-semibold text-amber-900">安全替代回复</p>
          <p className="mt-1 text-[11px] leading-6 text-amber-950">{riskResult.safeReply}</p>
        </div>
      ) : null}
    </section>
  );
}

export function EvaluationPanel({ evaluation }: { evaluation: AgentEvaluation | null }) {
  if (!evaluation) {
    return (
      <section className="agent-section">
        <p className="agent-section-title">执行评分报告</p>
        <div className="empty-state min-h-[120px]">
          <CircleDashed className="size-5" aria-hidden />
          <p className="text-xs">尚未生成评分</p>
        </div>
      </section>
    );
  }

  return (
    <section className="agent-section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="agent-section-title">执行评分报告</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{evaluation.summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={evaluation.status === 'PASS' ? 'success' : 'danger'}>
            {evaluation.status}
          </Badge>
          <span className="text-sm font-semibold tabular-nums">{evaluation.score}</span>
          <span className="text-[10px] text-muted-foreground">/ 100</span>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {evaluation.checks.map((check) => (
          <li key={check.id} className="flex items-start justify-between gap-3 border-b border-border/70 py-1.5 last:border-b-0">
            <div className="min-w-0">
              <p className="text-[11px] font-medium">{check.label}</p>
              <p className="mt-0.5 text-[10px] leading-5 text-muted-foreground">{check.detail}</p>
            </div>
            <Badge
              tone={
                check.status === 'PASS'
                  ? 'success'
                  : check.status === 'WARN'
                    ? 'warning'
                    : 'danger'
              }
            >
              {check.status}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SchemaBlock({ schema }: { schema: JsonSchema }) {
  return <pre className="json-block">{JSON.stringify(schema, null, 2)}</pre>;
}
