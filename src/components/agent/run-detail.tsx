'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  BookOpenCheck,
  FlaskConical,
  History,
  Clock3,
  LoaderCircle,
  MessageSquarePlus,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  EvaluationPanel,
  PlanPanel,
  ProviderBadge,
  RiskPanel,
  RunStatusBadge,
  StepsTimeline,
} from '@/components/agent/run-view';
import { apiRequest, formatDateTime, jsonBody } from '@/lib/client';
import { RunConversation } from '@/components/agent/run-conversation';
import type {
  ExplainResponse,
  RetryRunResponse,
  RunAnnotation,
  RunDetailResponse,
} from '@/lib/types';

function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" className="empty-state rounded-xl border bg-card">
      <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden />
      <p className="text-xs">{label}</p>
    </div>
  );
}

export function RunDetailView({ runId }: { runId: string }) {
  const router = useRouter();
  const [data, setData] = useState<RunDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [handoffReason, setHandoffReason] = useState('用户需要人工跟进');
  const [handoffPending, setHandoffPending] = useState(false);
  const [annotationLabel, setAnnotationLabel] = useState('需要人工跟进');
  const [annotationNote, setAnnotationNote] = useState('');
  const [annotationPending, setAnnotationPending] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [evalPending, setEvalPending] = useState(false);
  const [explanation, setExplanation] = useState<ExplainResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiRequest<RunDetailResponse>(`/api/runs/${encodeURIComponent(runId)}`);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setData(result.data);
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      const result = await apiRequest<RunDetailResponse>(
        `/api/runs/${encodeURIComponent(runId)}`,
      );
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setData(result.data);
    }
    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  async function retry() {
    if (!data || retrying) return;
    setRetrying(true);
    const result = await apiRequest<RetryRunResponse>('/api/run/retry', {
      method: 'POST',
      body: jsonBody({ runId: data.run.id }),
    });
    setRetrying(false);
    if (!result.ok) {
      toast.error('重试运行失败', { description: result.error });
      return;
    }
    toast.success('已生成新的运行记录', { description: result.data.run.id });
    router.push(`/runs/${result.data.run.id}`);
  }

  async function handoff() {
    if (!data || handoffPending) return;
    setHandoffPending(true);
    const result = await apiRequest<{ run: RunDetailResponse['run']; ticket?: { id: string } }>(
      `/api/runs/${encodeURIComponent(data.run.id)}/handoff`,
      {
        method: 'POST',
        body: jsonBody({ reason: handoffReason, by: '运营管理员' }),
      },
    );
    setHandoffPending(false);
    if (!result.ok) {
      toast.error('人工接管失败', { description: result.error });
      return;
    }
    setData((current) => (current ? { ...current, run: result.data.run } : current));
    toast.success('已标记人工接管并生成工单', { description: result.data.ticket?.id });
  }

  async function addToEval() {
    if (!data || evalPending) return;
    setEvalPending(true);
    const result = await apiRequest<{ case: { id: string; name: string } }>('/api/eval/from-run', {
      method: 'POST',
      body: jsonBody({ runId: data.run.id }),
    });
    setEvalPending(false);
    if (!result.ok) {
      toast.error('加入评测集失败', { description: result.error });
      return;
    }
    toast.success('已加入评测集', { description: result.data.case.name });
  }

  async function annotate() {
    if (!data || annotationPending) return;
    if (!annotationLabel.trim()) {
      toast.error('请填写标注标签');
      return;
    }
    setAnnotationPending(true);
    const result = await apiRequest<{ annotation: RunAnnotation }>(
      `/api/runs/${encodeURIComponent(data.run.id)}/annotate`,
      {
        method: 'POST',
        body: jsonBody({
          label: annotationLabel,
          note: annotationNote,
          annotator: '运营管理员',
        }),
      },
    );
    setAnnotationPending(false);
    if (!result.ok) {
      toast.error('保存标注失败', { description: result.error });
      return;
    }
    setData((current) =>
      current
        ? { ...current, annotations: [result.data.annotation, ...current.annotations] }
        : current,
    );
    setAnnotationNote('');
    toast.success('标注已保存');
  }

  async function explain() {
    if (!data || explaining) return;
    setExplaining(true);
    const result = await apiRequest<ExplainResponse>('/api/explain', {
      method: 'POST',
      body: jsonBody({ runId: data.run.id }),
    });
    setExplaining(false);
    if (!result.ok) {
      toast.error('解释生成失败', { description: result.error });
      return;
    }
    setExplanation(result.data);
  }

  if (loading && !data) return <LoadingBlock label="正在读取 RunRecord、Trace 与标注…" />;

  if (error || !data) {
    return (
      <div className="page-stack">
        <div role="alert" className="empty-state rounded-xl border bg-card">
          <AlertCircle className="size-7 text-primary" aria-hidden />
          <h1 className="text-base font-semibold">无法加载运行记录</h1>
          <p className="max-w-md text-xs leading-5">{error ?? '运行记录不存在。'}</p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void load()}>
              <RefreshCw aria-hidden />
              重试
            </Button>
            <Button asChild variant="outline">
              <Link href="/runs">返回运行记录</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { run, annotations } = data;
  const toolSteps = run.steps.filter((step) => step.type === 'tool');

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div className="min-w-0">
          <p className="eyebrow">AGENT / RUN DETAIL</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="page-title">运行详情</h1>
            <RunStatusBadge status={run.status} />
          </div>
          <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{run.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/runs">
              <ArrowLeft aria-hidden />
              返回运行列表
            </Link>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={explain} disabled={explaining}>
            {explaining ? <LoaderCircle className="animate-spin" aria-hidden /> : <BookOpenCheck aria-hidden />}
            {explaining ? '解释中…' : '解释本次运行'}
          </Button>
          <Button type="button" onClick={retry} disabled={retrying}>
            {retrying ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            {retrying ? '重试中…' : '重试运行'}
          </Button>
          <Button type="button" variant="outline" onClick={() => void addToEval()} disabled={evalPending}>
            {evalPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <FlaskConical aria-hidden />}
            {evalPending ? '加入中…' : '加入评测集'}
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">用户问题</CardTitle>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-6">{run.question}</p>
          </div>
          <ProviderBadge provider={run.provider} model={run.model} isDemo={run.isDemo} />
        </CardHeader>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="meta-cell">
            <p className="meta-label">Source</p>
            <p>{run.source}</p>
          </div>
          <div className="meta-cell">
            <p className="meta-label">Conversation</p>
            <p className="break-all font-mono text-[10px]">{run.conversationId}</p>
          </div>
          <div className="meta-cell">
            <p className="meta-label">Created</p>
            <p>{formatDateTime(run.createdAt)}</p>
          </div>
          <div className="meta-cell">
            <p className="meta-label">Duration</p>
            <p className="inline-flex items-center gap-1">
              <Clock3 className="size-3" aria-hidden />
              {run.durationMs < 1000 ? `${run.durationMs}ms` : `${(run.durationMs / 1000).toFixed(1)}s`}
            </p>
          </div>
          <div className="meta-cell">
            <p className="meta-label">Planner Plan</p>
            <p>{run.plan ? '已生成' : '缺失'}</p>
          </div>
          <div className="meta-cell">
            <p className="meta-label">Tool Steps</p>
            <p>{toolSteps.length} 个</p>
          </div>
          <div className="meta-cell">
            <p className="meta-label">Risk Decision</p>
            <p>{run.riskResult ? `${run.riskResult.decision} / ${run.riskResult.riskLevel}` : '无'}</p>
          </div>
          <div className="meta-cell">
            <p className="meta-label">Retry Of</p>
            <p className="break-all font-mono text-[10px]">{run.retryOf ?? '—'}</p>
          </div>
          {run.error ? (
            <div className="meta-cell sm:col-span-2 lg:col-span-4">
              <p className="meta-label">Error</p>
              <p className="whitespace-pre-wrap text-red-700">
                {run.errorCode ? <span className="font-mono">[{run.errorCode}] </span> : null}
                {run.error}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-primary" aria-hidden />
            对话上下文
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <RunConversation run={run} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            最终回复
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <p className="whitespace-pre-wrap text-[13px] leading-7">
            {run.finalReply ?? '本次运行没有最终回复。'}
          </p>
        </CardContent>
      </Card>

      {explanation ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>运行解释</CardTitle>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{explanation.summary}</p>
            </div>
            <Badge tone="neutral">{formatDateTime(explanation.generatedAt)}</Badge>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div>
              <p className="agent-label">规划理由</p>
              <p className="mt-1 text-[11px] leading-6 text-muted-foreground">{explanation.planReasoning}</p>
            </div>
            <div>
              <p className="agent-label">风险解释</p>
              <p className="mt-1 whitespace-pre-wrap text-[11px] leading-6 text-muted-foreground">
                {explanation.riskExplanation}
              </p>
            </div>
            <div>
              <p className="agent-label">证据</p>
              <ul className="mt-1 list-inside list-disc space-y-1 text-[10px] leading-5 text-muted-foreground">
                {explanation.evidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="agent-label">建议</p>
              <ul className="mt-1 list-inside list-disc space-y-1 text-[10px] leading-5 text-muted-foreground">
                {explanation.suggestions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="detail-grid">
        <Card>
          <PlanPanel plan={run.plan} validation={run.validation} />
        </Card>
        <Card>
          <RiskPanel riskResult={run.riskResult} />
        </Card>
        <Card>
          <EvaluationPanel evaluation={run.evaluation} />
        </Card>
        <Card className="detail-span">
          <StepsTimeline steps={run.steps} />
        </Card>
      </div>

      <div className="detail-grid">
        <Card>
          <CardHeader className="gap-3">
            <CardTitle className="flex items-center gap-2">
              <UserRoundCheck className="size-4 text-primary" aria-hidden />
              人工接管
            </CardTitle>
            {run.ticketId ? <p className="text-[10px] text-emerald-800">已关联客服工单 <Link href={`/tickets#${run.ticketId}`} className="font-medium underline">{run.ticketId}</Link></p> : null}
            {run.handoff ? (
              <p className="text-[11px] leading-5 text-amber-900">
                已接管：{run.handoff.reason} · {run.handoff.by} · {formatDateTime(run.handoff.at)}
              </p>
            ) : (
              <p className="text-[11px] leading-5 text-muted-foreground">
                把当前运行标记为人工接管，状态会更新为“转人工”并保留原因。
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-2 pt-4">
            <Input
              value={handoffReason}
              onChange={(event) => setHandoffReason(event.target.value)}
              placeholder="填写接管原因"
              maxLength={500}
            />
            <Button type="button" variant="outline" size="sm" onClick={handoff} disabled={handoffPending}>
              {handoffPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <UserRoundCheck aria-hidden />}
              {handoffPending ? '接管中…' : '标记人工接管'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="flex items-center gap-2">
              <MessageSquarePlus className="size-4 text-primary" aria-hidden />
              人工标注
            </CardTitle>
            <p className="text-[11px] leading-5 text-muted-foreground">
              保存到 annotations.json，可在后续评测和改进中使用。
            </p>
          </CardHeader>
          <CardContent className="space-y-2 pt-4">
            <Input
              value={annotationLabel}
              onChange={(event) => setAnnotationLabel(event.target.value)}
              placeholder="标注标签"
              maxLength={80}
            />
            <Textarea
              value={annotationNote}
              onChange={(event) => setAnnotationNote(event.target.value)}
              placeholder="补充说明（可选）"
              className="min-h-[80px]"
              maxLength={2000}
            />
            <Button type="button" size="sm" onClick={annotate} disabled={annotationPending}>
              {annotationPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <MessageSquarePlus aria-hidden />}
              {annotationPending ? '保存中…' : '保存标注'}
            </Button>

            {annotations.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {annotations.map((annotation) => (
                  <li key={annotation.id} className="rounded-md border bg-muted/20 px-3 py-2">
                    <p className="text-[11px] font-semibold">{annotation.label}</p>
                    {annotation.note ? (
                      <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{annotation.note}</p>
                    ) : null}
                    <p className="mt-1 text-[9px] text-muted-foreground">
                      {annotation.annotator} · {formatDateTime(annotation.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pt-1 text-[10px] text-muted-foreground">还没有人工标注。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>版本引用</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div>
              <p className="agent-label">Skills</p>
              <ul className="mt-1 space-y-1">
                {run.skillVersions.length === 0 ? (
                  <li className="text-[10px] text-muted-foreground">无</li>
                ) : (
                  run.skillVersions.map((skill) => (
                    <li key={`${skill.skillId}-${skill.version}`} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-mono">{skill.skillId}</span>
                      <Badge tone="neutral">v{skill.version}</Badge>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div>
              <p className="agent-label">Tools</p>
              <ul className="mt-1 space-y-1">
                {run.toolVersions.length === 0 ? (
                  <li className="text-[10px] text-muted-foreground">无</li>
                ) : (
                  run.toolVersions.map((tool) => (
                    <li key={`${tool.toolId}-${tool.version}`} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-mono">{tool.toolId}</span>
                      <Badge tone="neutral">v{tool.version}</Badge>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="page-note">
        所有自动步骤、失败错误、风险判断和评分均来自持久化 RunRecord；刷新页面后仍可查看。重试会创建新的
        RunRecord，并保留原记录。
      </p>
    </div>
  );
}
