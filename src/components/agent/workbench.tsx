'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  Bot,
  LoaderCircle,
  MessageSquareText,
  Play,
  RotateCcw,
  RefreshCw,
  Sparkles,
  Square,
  TerminalSquare,
  UserRoundCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  EvaluationPanel,
  PlanPanel,
  ProviderBadge,
  RiskPanel,
  RunStatusBadge,
  StepsTimeline,
} from '@/components/agent/run-view';
import { AgentStreamError, streamAgentRun } from '@/lib/agent-stream';
import { apiRequest, jsonBody } from '@/lib/client';
import type {
  AgentEvaluation,
  AgentPlan,
  AgentProviderSelection,
  AgentStep,
  AgentStreamEvent,
  ChatRatingResult,
  ConversationMessage,
  ExplainResponse,
  PlanValidation,
  RiskResult,
  Run,
  StepRetryResponse,
} from '@/lib/types';

const EXAMPLE_PROMPTS = [
  {
    label: '填入推荐问题',
    value: '给同事买点不辣的办公室零食，预算 100 元以内。',
  },
  {
    label: '填入价格问题',
    value: '我买 3 份每日混合坚果，叠加满 99 减 20 和 SNACK20 优惠券，最后多少钱？',
  },
  {
    label: '填入物流问题',
    value: '帮我查一下订单 SN202610170014 的物流到哪了？',
  },
  {
    label: '填入诈骗问题',
    value: '收到短信说我中奖了，让我提供验证码并转账保证金，是真的吗？',
  },
];

const PROVIDERS: { value: AgentProviderSelection; label: string }[] = [
  { value: 'classroom-fixture', label: '课堂演示（确定性）' },
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'coze', label: 'Coze LLM' },
  { value: 'auto', label: '自动选择' },
];

export function AgentWorkbench() {
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<AgentProviderSelection>('auto');
  const [mandatoryInput, setMandatoryInput] = useState('');
  const [turns, setTurns] = useState<ConversationMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [validation, setValidation] = useState<PlanValidation | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [evaluation, setEvaluation] = useState<AgentEvaluation | null>(null);
  const [finalReply, setFinalReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveProvider, setLiveProvider] = useState<{
    provider: string;
    model: string;
    isDemo: boolean;
  } | null>(null);
  const [retryingStepId, setRetryingStepId] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<ExplainResponse | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [handoffReason, setHandoffReason] = useState('用户需要人工进一步跟进');
  const [handoffPending, setHandoffPending] = useState(false);
  const [runRatingScore, setRunRatingScore] = useState<number | null>(null);
  const [runRatingSubmitted, setRunRatingSubmitted] = useState(false);
  const [runRatingSaving, setRunRatingSaving] = useState(false);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const explanationRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!explanation) return;
    explanationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [explanation]);

  function resetLiveState() {
    setRun(null);
    setPlan(null);
    setValidation(null);
    setSteps([]);
    setRiskResult(null);
    setEvaluation(null);
    setFinalReply(null);
    setError(null);
    setLiveProvider(null);
    setExplanation(null);
    setRetryingStepId(null);
    setRunRatingScore(null);
    setRunRatingSubmitted(false);
  }

  async function runAgent() {
    const question = input.trim();
    if (!question || running) return;

    const history = turns;
    resetLiveState();
    setRunning(true);
    setTurns((current) => [...current, { role: 'user', content: question }]);
    setInput('');
    const controller = new AbortController();
    abortRef.current = controller;
    let finalText: string | null = null;

    try {
      await streamAgentRun(
        {
          userInput: question,
          conversationHistory: history,
          conversationId: conversationIdRef.current,
          source: 'workbench',
          provider,
          mandatoryCapabilities: mandatoryInput
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        },
        (event: AgentStreamEvent) => {
          if (event.type === 'run') {
            setRun(event.run);
            conversationIdRef.current = event.run.conversationId;
            setLiveProvider({
              provider: event.run.provider,
              model: event.run.model,
              isDemo: event.run.isDemo,
            });
          }
          if (event.type === 'plan') {
            setPlan(event.plan);
            setValidation(event.validation);
            setLiveProvider({
              provider: event.provider,
              model: event.model,
              isDemo: event.isDemo,
            });
          }
          if (event.type === 'step') {
            setSteps((current) =>
              current.some((step) => step.id === event.step.id)
                ? current
                : [...current, event.step],
            );
          }
          if (event.type === 'error') {
            setError(event.error);
            if (event.run) setRun(event.run);
          }
          if (event.type === 'final') {
            setFinalReply(event.finalReply);
            setRiskResult(event.riskResult);
            setEvaluation(event.evaluation);
            finalText = event.finalReply;
            if (event.status === '成功') {
              toast.success('Agent 运行完成', { description: '最终回复已通过风险审核。' });
            } else if (event.status === '转人工') {
              toast.warning('Agent 已转人工', { description: '请查看风险结果与安全替代回复。' });
            } else {
              toast.error('Agent 运行失败', { description: '请查看 Trace 中的失败步骤。' });
            }
          }
          if (event.type === 'done') {
            setRun(event.run);
            if (event.run.finalReply) setFinalReply(event.run.finalReply);
            if (event.run.riskResult) setRiskResult(event.run.riskResult);
            if (event.run.evaluation) setEvaluation(event.run.evaluation);
            if (event.run.plan) setPlan(event.run.plan);
            if (event.run.validation) setValidation(event.run.validation);
            setLiveProvider({
              provider: event.run.provider,
              model: event.run.model,
              isDemo: event.run.isDemo,
            });
          }
        },
        controller.signal,
      );
    } catch (caught) {
      if (caught instanceof AgentStreamError) {
        setError(`${caught.code} · ${caught.message}`);
        toast.error('Agent 请求失败', { description: caught.message });
      } else if (caught instanceof DOMException && caught.name === 'AbortError') {
        setError('本次运行已被停止。');
      } else {
        setError(caught instanceof Error ? caught.message : 'Agent 运行失败');
        toast.error('Agent 运行失败');
      }
    } finally {
      const completedReply = finalText;
      if (completedReply) {
        setTurns((current) => {
          const last = current[current.length - 1];
          if (last?.role === 'assistant' && last.content === completedReply) return current;
          return [...current, { role: 'assistant', content: completedReply }];
        });
      }
      setRunning(false);
      abortRef.current = null;
    }
  }

  async function submitRunRating(score: number) {
    if (!run || runRatingSaving || runRatingSubmitted) return;
    setRunRatingSaving(true);
    const conversation =
      turns.length > 0
        ? turns
        : [
            { role: 'user' as const, content: run.question },
            { role: 'assistant' as const, content: run.finalReply ?? '' },
          ];
    const result = await apiRequest<ChatRatingResult>('/api/ratings', {
      method: 'POST',
      body: jsonBody({
        runId: run.id,
        conversationId: run.conversationId,
        score,
        source: 'agent',
        question: run.question,
        conversation,
      }),
    });
    setRunRatingSaving(false);
    if (!result.ok) {
      toast.error('Agent 评分保存失败', { description: result.error });
      return;
    }
    setRunRatingScore(score);
    setRunRatingSubmitted(true);
    toast.success(`Agent 评分已保存：${score} 分`);
  }

  async function retryStep(step: AgentStep) {
    if (!run || retryingStepId) return;
    setRetryingStepId(step.id);
    const result = await apiRequest<StepRetryResponse>(
      `/api/runs/${encodeURIComponent(run.id)}/steps/${encodeURIComponent(step.id)}/retry`,
      { method: 'POST' },
    );
    setRetryingStepId(null);
    if (!result.ok) {
      toast.error('步骤重试失败', { description: result.error });
      setError(result.error);
      return;
    }
    setRun(result.data.run);
    setSteps(result.data.run.steps);
    if (result.data.step.status === 'SUCCESS') {
      toast.success('步骤重试成功', {
        description: '新的重试步骤已写入 Trace；整条运行状态不会自动改写。',
      });
    } else {
      toast.error('步骤重试仍失败', {
        description: result.data.step.error ?? '请查看新的 ERROR 步骤。',
      });
    }
  }

  async function explainRun() {
    if (!run || explaining) return;
    setExplaining(true);
    const result = await apiRequest<ExplainResponse>('/api/explain', {
      method: 'POST',
      body: jsonBody({ runId: run.id }),
    });
    setExplaining(false);
    if (!result.ok) {
      toast.error('运行解释生成失败', { description: result.error });
      return;
    }
    setExplanation(result.data);
  }

  async function handoffRun() {
    if (!run || handoffPending) return;
    setHandoffPending(true);
    const result = await apiRequest<{ run: Run; ticket?: { id: string } }>(
      `/api/runs/${encodeURIComponent(run.id)}/handoff`,
      {
        method: 'POST',
        body: jsonBody({ reason: handoffReason.trim() || '用户需要人工进一步跟进', by: '运营管理员' }),
      },
    );
    setHandoffPending(false);
    if (!result.ok) {
      toast.error('人工接管失败', { description: result.error });
      return;
    }
    setRun(result.data.run);
    toast.success('已标记人工接管并生成工单', {
      description: `${result.data.run.id}${result.data.ticket ? ` · ${result.data.ticket.id}` : ''} · 运营管理员`,
    });
  }

  function stopRun() {
    abortRef.current?.abort();
    setRunning(false);
  }

  function clearConversation() {
    if (running) return;
    setTurns([]);
    setInput('');
    conversationIdRef.current = undefined;
    resetLiveState();
  }

  const activeStatus = run?.status ?? (running ? '运行中' : null);

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div className="min-w-0">
          <p className="eyebrow">AGENT / LIVE WORKBENCH</p>
          <h1 className="page-title">Agent 工作台</h1>
          <p className="page-subtitle">
            Planner 生成计划，Validator 独立校验，Executor 调用启用的 Skill / Tool，最后经 risk-check
            审核并生成评分报告。演示 Provider 与真实 Provider 走同一条执行链路。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">主链路</Badge>
          <Badge tone="neutral">JSON Trace</Badge>
          {activeStatus ? <RunStatusBadge status={activeStatus} /> : null}
        </div>
      </header>

      <div className="agent-workbench">
        <div className="agent-left-column">
          <Card>
            <CardHeader className="gap-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquareText className="size-4 text-primary" aria-hidden />
                  发起客服任务
                </CardTitle>
                <Badge tone="neutral">{turns.length} 条对话</Badge>
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                真实 Provider 缺少密钥时会返回结构化错误，不会静默降级为课堂演示。
              </p>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="field-group">
                  <span className="field-label">Provider</span>
                  <select
                    className="field-select"
                    value={provider}
                    onChange={(event) => setProvider(event.target.value as AgentProviderSelection)}
                    disabled={running}
                  >
                    {PROVIDERS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-group">
                  <span className="field-label">强制能力（可选）</span>
                  <input
                    className="field-select font-mono text-[10px]"
                    value={mandatoryInput}
                    onChange={(event) => setMandatoryInput(event.target.value)}
                    placeholder="skill:risk-check, tool:query_orders"
                    disabled={running}
                  />
                </label>
              </div>

              <label className="field-group">
                <span className="field-label">用户问题</span>
                <Textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  className="min-h-[120px]"
                  placeholder="例如：给同事买点不辣的办公室零食，预算 100 元以内。"
                  disabled={running}
                  maxLength={6000}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      void runAgent();
                    }
                  }}
                />
                <span className="field-hint">⌘/Ctrl + Enter 运行。每次运行都会持久化完整 Trace。</span>
              </label>

              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPTS.map((example) => (
                  <button
                    key={example.label}
                    type="button"
                    className="example-chip"
                    onClick={() => setInput(example.value)}
                    disabled={running}
                  >
                    {example.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="button" onClick={runAgent} disabled={running || !input.trim()}>
                  {running ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}
                  {running ? '运行中…' : '运行 Agent'}
                </Button>
                {running ? (
                  <Button type="button" variant="outline" onClick={stopRun}>
                    <Square aria-hidden />
                    停止运行
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={clearConversation} disabled={turns.length === 0}>
                    <RotateCcw aria-hidden />
                    清空对话
                  </Button>
                )}
                {liveProvider ? (
                  <ProviderBadge
                    provider={liveProvider.provider}
                    model={liveProvider.model}
                    isDemo={liveProvider.isDemo}
                  />
                ) : null}
              </div>

              {error ? (
                <div role="alert" className="alert alert-danger">
                  <AlertCircle className="size-4 shrink-0" aria-hidden />
                  <span>{error}</span>
                </div>
              ) : null}

              {running ? (
                <p role="status" aria-live="polite" className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                  {plan ? `正在执行 ${steps.length} 个步骤…` : 'Planner 正在生成计划并校验能力…'}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>对话记录</CardTitle>
              <p className="text-[11px] leading-5 text-muted-foreground">
                下一轮运行会把这里的 user / assistant 消息作为 conversationHistory 发送。
              </p>
            </CardHeader>
            <CardContent className="pt-4">
              {turns.length === 0 ? (
                <div className="empty-state min-h-[150px]">
                  <Bot className="size-6" aria-hidden />
                  <p className="text-xs font-medium">还没有对话</p>
                  <p className="max-w-xs text-[11px] leading-5">
                    输入问题并运行 Agent，计划、步骤和最终回复会显示在右侧。
                  </p>
                </div>
              ) : (
                <ul className="agent-chat-history">
                  {turns.slice(-8).map((turn, index) => (
                    <li key={`${turn.role}-${index}-${turn.content.slice(0, 12)}`} className={`chat-bubble chat-${turn.role}`}>
                      <p className="chat-role">{turn.role === 'user' ? '用户' : '客服 Agent'}</p>
                      <p className="whitespace-pre-wrap">{turn.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="agent-right-column">
          {finalReply ? (
            <Card className="agent-final-card">
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="size-4 text-primary" aria-hidden />
                      最终回复
                    </CardTitle>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      已经过 risk-check；失败或转人工时会展示安全替代表述。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activeStatus ? <RunStatusBadge status={activeStatus} /> : null}
                    {run ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={explainRun}
                          disabled={explaining}
                        >
                          {explaining ? (
                            <LoaderCircle className="animate-spin" aria-hidden />
                          ) : (
                            <BookOpenCheck aria-hidden />
                          )}
                          {explaining ? '解释中…' : '解释本次运行'}
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/runs/${run.id}`}>
                            查看完整 Trace
                            <ArrowRight aria-hidden />
                          </Link>
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-3">
                <p className="whitespace-pre-wrap text-[13px] leading-7">{finalReply}</p>
                {run ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                    <span className="text-[10px] text-muted-foreground">这次 Agent 服务评分：</span>
                    {[1, 2, 3, 4, 5].map((score) => (
                      <button
                        key={score}
                        type="button"
                        className={`ops-score-button ${runRatingScore === score ? 'ops-score-button-active' : ''}`}
                        onClick={() => void submitRunRating(score)}
                        disabled={runRatingSaving || runRatingSubmitted}
                        aria-label={`Agent 评分 ${score} 分`}
                      >
                        {score}
                      </button>
                    ))}
                    {runRatingSubmitted ? <span className="text-[10px] text-emerald-700">已保存，进入运营中心服务评分。</span> : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="empty-state min-h-[180px]">
                <TerminalSquare className="size-6 text-primary" aria-hidden />
                <p className="text-sm font-medium">等待一次 Agent 运行</p>
                <p className="max-w-md text-[11px] leading-5">
                  运行后会在这里显示最终回复。右侧同时展示 Planner、Validator、步骤 Trace、风险结果和评分报告。
                </p>
              </CardContent>
            </Card>
          )}

          {riskResult ? (
            <Card>
              <RiskPanel riskResult={riskResult} />
            </Card>
          ) : null}

          {evaluation ? (
            <Card>
              <EvaluationPanel evaluation={evaluation} />
            </Card>
          ) : null}

          <Card>
            <PlanPanel plan={plan} validation={validation} />
          </Card>

          <Card>
            <StepsTimeline
              steps={steps}
              onRetryStep={run && !running ? (step) => void retryStep(step) : undefined}
              retryingStepId={retryingStepId}
            />
          </Card>

          {!plan && running ? (
            <Card>
              <CardContent className="space-y-3 py-5">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  Planner 生成中
                </p>
                <div className="h-24 animate-pulse rounded-lg bg-muted" />
                <div className="h-40 animate-pulse rounded-lg bg-muted" />
              </CardContent>
            </Card>
          ) : null}

          {explanation ? (
            <div ref={explanationRef} className="scroll-mt-24">
            <Card>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Agent 运行解释</CardTitle>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{explanation.summary}</p>
                </div>
                <Badge tone="neutral">{explanation.generatedAt.slice(0, 16).replace('T', ' ')}</Badge>
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
                    {explanation.evidence.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="agent-label">建议</p>
                  <ul className="mt-1 list-inside list-disc space-y-1 text-[10px] leading-5 text-muted-foreground">
                    {explanation.suggestions.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </CardContent>
            </Card>
            </div>
          ) : null}

          {run && !running ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserRoundCheck className="size-4 text-primary" aria-hidden />
                  人工接管
                </CardTitle>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  支持将当前 RunRecord 标记为人工跟进；接管原因会持久化。
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {run.ticketId ? <p className="text-[10px] text-emerald-800">已关联客服工单 <Link href={`/tickets#${run.ticketId}`} className="font-medium underline">{run.ticketId}</Link></p> : null}
                {run.handoff ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    已接管：{run.handoff.reason} · {run.handoff.by}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      className="field-select flex-1"
                      value={handoffReason}
                      onChange={(event) => setHandoffReason(event.target.value)}
                      maxLength={500}
                      aria-label="人工接管原因"
                    />
                    <Button type="button" variant="outline" onClick={handoffRun} disabled={handoffPending}>
                      {handoffPending ? (
                        <RefreshCw className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <UserRoundCheck className="size-3.5" aria-hidden />
                      )}
                      {handoffPending ? '接管中…' : '标记人工接管'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

        </div>
      </div>
    </div>
  );
}
