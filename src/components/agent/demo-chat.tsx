'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  LoaderCircle,
  MessageCircle,
  RotateCcw,
  Send,
  ShieldAlert,
  Star,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { AgentStreamError, streamAgentRun } from '@/lib/agent-stream';
import { apiRequest, jsonBody } from '@/lib/client';
import type {
  AgentProviderSelection,
  AgentStep,
  ChatRatingResult,
  ConversationMessage,
  RiskResult,
  Run,
} from '@/lib/types';

type DemoMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  status?: Run['status'];
  risk?: RiskResult | null;
  runId?: string;
  ticketId?: string;
  error?: boolean;
};

const PROVIDERS: { value: AgentProviderSelection; label: string }[] = [
  { value: 'classroom-fixture', label: '课堂演示' },
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'coze', label: 'Coze LLM' },
  { value: 'auto', label: '自动选择' },
];

const QUICK_QUESTIONS = [
  {
    label: '查一下物流',
    value: '帮我查一下订单 SN202610170014 的物流到哪了？',
  },
  {
    label: '推荐办公室零食',
    value: '给同事买点不辣的办公室零食，预算 100 元以内。',
  },
  {
    label: '算一下券后价',
    value: '我买 3 份每日混合坚果，叠加满 99 减 20 和 SNACK20 优惠券，最后多少钱？',
  },
];

const IDLE_END_MS = 90_000;
const TYPING_DELAY_MS = 900;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function DemoChat() {
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<AgentProviderSelection>('auto');
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState('在线');
  const [planSummary, setPlanSummary] = useState<string | null>(null);
  const [lastUserQuestion, setLastUserQuestion] = useState('');
  const [sessionEndReason, setSessionEndReason] = useState<'agent' | 'idle' | null>(null);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [ratingScore, setRatingScore] = useState<number | null>(null);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idCounterRef = useRef(0);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, running, sessionClosed, ratingSubmitted, planSummary]);

  useEffect(() => {
    return () => {
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
    };
  }, []);

  function clearEndTimer() {
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
  }

  function clearSessionEnd() {
    clearEndTimer();
    setSessionEndReason(null);
    setSessionClosed(false);
    setRatingScore(null);
    setRatingSubmitted(false);
    setRatingError(null);
  }

  function scheduleSessionEnd(reason: 'agent' | 'idle') {
    clearEndTimer();
    setSessionEndReason(reason);
    endTimerRef.current = setTimeout(
      () => {
        endTimerRef.current = null;
        setSessionClosed(true);
      },
      reason === 'agent' ? 900 : IDLE_END_MS,
    );
  }

  function nextId(prefix: string): string {
    idCounterRef.current += 1;
    return `${prefix}-${idCounterRef.current}`;
  }

  async function sendQuestion(forcedQuestion?: string) {
    const question = (forcedQuestion ?? input).trim();
    if (!question || running || sessionClosed) return;

    clearSessionEnd();
    setLastUserQuestion(question);
    const history: ConversationMessage[] = messages
      .filter((message) => !message.pending && !message.error)
      .map((message) => ({ role: message.role, content: message.content }));
    const assistantId = nextId('assistant');
    setMessages((current) => [
      ...current,
      { id: nextId('user'), role: 'user', content: question },
      {
        id: assistantId,
        role: 'assistant',
        content: '正在输入…',
        pending: true,
      },
    ]);
    setInput('');
    setRunning(true);
    setPlanSummary(null);
    setStage('正在输入…');
    let finalSeen = false;

    try {
      // 保留约 1 秒的“正在输入…”可见时间，真实请求随后进入 Agent 主链路。
      await sleep(TYPING_DELAY_MS);
      await streamAgentRun(
        {
          userInput: question,
          conversationHistory: history,
          conversationId: conversationIdRef.current,
          source: 'demo',
          provider,
        },
        (event) => {
          if (event.type === 'run') {
            conversationIdRef.current = event.run.conversationId;
            setStage('Planner 正在生成计划…');
          }
          if (event.type === 'plan') {
            const skillCount = event.plan.selectedSkills.length;
            const toolCount = event.plan.selectedTools.length;
            setPlanSummary(
              `Planner：${skillCount} 个 Skill / ${toolCount} 个 Tool · 校验${event.validation.valid ? '通过' : '未通过'}`,
            );
            setStage('执行 Skill 与 Tool…');
          }
          if (event.type === 'step') {
            const step = event.step as AgentStep;
            setStage(
              `${step.type === 'tool' ? 'Tool' : 'Skill'} · ${step.title} · ${
                step.status === 'SUCCESS' ? '完成' : '失败'
              }`,
            );
          }
          if (event.type === 'final') {
            finalSeen = true;
            setStage(event.status === '成功' ? '在线' : event.status);
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      content: event.finalReply,
                      pending: false,
                      status: event.status,
                      risk: event.riskResult,
                    }
                  : message,
              ),
            );
            if (event.status === '成功') {
              toast.success('回复已通过风险审核');
            } else if (event.status === '转人工') {
              toast.warning('已转人工复核');
            } else {
              toast.error('本次运行失败，请查看完整 Trace');
            }
          }
          if (event.type === 'error') {
            setStage(event.error);
          }
          if (event.type === 'done') {
            conversationIdRef.current = event.run.conversationId;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      content:
                        message.pending
                          ? event.run.finalReply ?? event.run.error ?? '运行结束'
                          : message.content,
                      pending: false,
                      status: event.run.status,
                      risk: event.run.riskResult,
                      runId: event.run.id,
                      ticketId: event.run.ticketId ?? undefined,
                    }
                  : message,
              ),
            );
            scheduleSessionEnd(event.run.conversationEnded ? 'agent' : 'idle');
          }
        },
      );
    } catch (caught) {
      const message =
        caught instanceof AgentStreamError
          ? `${caught.code} · ${caught.message}`
          : caught instanceof Error
            ? caught.message
            : '消息发送失败';
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? { ...item, content: message, pending: false, error: true }
            : item,
        ),
      );
      setStage(message);
      toast.error('Agent 请求失败', { description: message });
    } finally {
      if (!finalSeen) {
        setMessages((current) =>
          current.map((item) =>
            item.id === assistantId && item.pending
              ? {
                  ...item,
                  content: item.content || '本次运行没有返回最终回复。',
                  pending: false,
                  error: true,
                }
              : item,
          ),
        );
      }
      setRunning(false);
    }
  }

  async function submitRating(score: number) {
    if (ratingSubmitting || ratingSubmitted) return;
    const target = [...messages].reverse().find((message) => message.runId);
    if (!target?.runId) {
      setRatingError('没有可关联的运行记录，暂时无法保存评分。');
      return;
    }
    setRatingSubmitting(true);
    setRatingError(null);
    const result = await apiRequest<ChatRatingResult>('/api/ratings', {
      method: 'POST',
      body: jsonBody({
        runId: target.runId,
        conversationId: conversationIdRef.current ?? `demo-${target.runId}`,
        score,
        question: lastUserQuestion,
        source: 'demo',
        conversation: messages
          .filter((message) => !message.pending && !message.error)
          .map((message) => ({ role: message.role, content: message.content })),
      }),
    });
    setRatingSubmitting(false);
    if (!result.ok) {
      setRatingError(result.error);
      toast.error('评分提交失败', { description: result.error });
      return;
    }
    setRatingScore(score);
    setRatingSubmitted(true);
    toast.success(`感谢评分：${score} 分`);
    if (result.data.improvement) {
      toast.warning('已进入 Bad Case / 改进队列', {
        description: `改进项 ${result.data.improvement.id} 已保存`,
      });
    }
  }

  function clearChat() {
    if (running) return;
    setMessages([]);
    setInput('');
    setPlanSummary(null);
    setStage('在线');
    setLastUserQuestion('');
    conversationIdRef.current = undefined;
    clearSessionEnd();
  }

  const lastAssistantRun = [...messages].reverse().find((message) => message.runId);
  const canRate = sessionClosed && Boolean(lastAssistantRun?.runId);

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div className="min-w-0">
          <p className="eyebrow">AGENT / SNACK ASSISTANT</p>
          <h1 className="page-title">零食小助手</h1>
          <p className="page-subtitle">
            和真实 Agent 对话。回复前会显示“正在输入…”，实际执行仍经过 Planner、Tool、risk-check 和 Trace 持久化。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">同一 Planner / Executor</Badge>
          <Button asChild variant="outline" size="sm">
            <Link href="/">
              打开完整工作台
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </header>

      <div className="demo-quick-questions" aria-label="常见问题">
        {QUICK_QUESTIONS.map((question) => (
          <button
            key={question.label}
            type="button"
            className="demo-quick-question"
            onClick={() => void sendQuestion(question.value)}
            disabled={running || sessionClosed}
          >
            <MessageCircle className="size-3.5" aria-hidden />
            {question.label}
          </button>
        ))}
      </div>

      <Card className="demo-chat-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="demo-chat-title">
            <span className="demo-online-dot" aria-label="在线" />
            <div>
              <p className="text-sm font-semibold">零食小助手</p>
              <p className="text-[10px] text-muted-foreground">
                在线 · SnackOps Agent
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" aria-hidden />
                {stage}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">{stage}</span>
            )}
            <select
              className="field-select field-select-compact text-[10px]"
              value={provider}
              onChange={(event) => setProvider(event.target.value as AgentProviderSelection)}
              disabled={running}
              aria-label="选择模型 Provider"
            >
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearChat}
              disabled={running || messages.length === 0}
            >
              <RotateCcw aria-hidden />
              清空
            </Button>
          </div>
        </div>

        <CardContent className="p-0">
          <div ref={scrollRef} className="demo-messages">
            {messages.length === 0 ? (
              <div className="empty-state min-h-[360px]">
                <Bot className="size-8 text-primary" aria-hidden />
                <p className="text-sm font-medium">从一个客服问题开始</p>
                <p className="max-w-md text-[11px] leading-5">
                  点选上方常见问题，或输入自己的问题。所有回复都经过 Planner、Tool 和 risk-check。
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <article key={message.id} className={`demo-message demo-${message.role}`}>
                  <span className="demo-avatar" aria-hidden>
                    {message.role === 'user' ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                  </span>
                  <div className="demo-bubble-wrap">
                    <div className="demo-message-meta">
                      <p className="text-[10px] font-semibold">
                        {message.role === 'user' ? '你' : '零食小助手'}
                      </p>
                      {message.status ? (
                        <Badge
                          tone={
                            message.status === '成功'
                              ? 'success'
                              : message.status === '转人工'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          {message.status}
                        </Badge>
                      ) : null}
                      {message.risk?.handoffRequired ? (
                        <Badge tone="warning">
                          <ShieldAlert className="size-3" aria-hidden />
                          建议人工跟进
                        </Badge>
                      ) : null}
                    </div>
                    <div
                      className={`demo-bubble ${
                        message.pending ? 'demo-bubble-typing' : ''
                      } ${message.error ? 'demo-bubble-error' : ''}`}
                    >
                      <p className="whitespace-pre-wrap text-xs leading-6">
                        {message.content}
                      </p>
                    </div>
                    {message.runId ? (
                      <Link
                        href={`/runs/${message.runId}`}
                        className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                      >
                        查看本次完整 Trace
                        <ArrowRight className="size-3" aria-hidden />
                      </Link>
                    ) : null}
                    {message.ticketId ? (
                      <Link
                        href={`/tickets#${message.ticketId}`}
                        className="ml-3 mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 hover:underline"
                      >
                        已生成客服工单 {message.ticketId}
                        <ArrowRight className="size-3" aria-hidden />
                      </Link>
                    ) : null}
                  </div>
                </article>
              ))
            )}

            {running && planSummary ? (
              <div className="demo-progress-note">{planSummary}</div>
            ) : null}

            {canRate ? (
              <div className="demo-rating-card" role="status">
                {ratingSubmitted ? (
                  <div className="space-y-2">
                    <CheckCircle2 className="mx-auto size-5 text-emerald-700" aria-hidden />
                    <p className="text-xs font-semibold">感谢你的评分</p>
                    <p className="text-[11px] text-muted-foreground">
                      本次服务评分：{ratingScore} 分
                    </p>
                    {ratingScore === 1 ? (
                      <p className="text-[10px] text-amber-800">
                        已保存到 Bad Case / 改进队列。
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold">本次服务已结束</p>
                      <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                        {sessionEndReason === 'idle'
                          ? '超过 90 秒没有继续发言，请为本次服务评分。'
                          : 'Agent 判断沟通流程已结束，请为本次服务评分。'}
                      </p>
                    </div>
                    <div className="demo-rating-scale" aria-label="服务评分">
                      {[1, 2, 3, 4, 5].map((score) => (
                        <button
                          key={score}
                          type="button"
                          className="demo-rating-button"
                          onClick={() => void submitRating(score)}
                          disabled={ratingSubmitting}
                          aria-label={`${score} 分`}
                        >
                          {score}
                        </button>
                      ))}
                    </div>
                    <p className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                      <Star className="size-3" aria-hidden />
                      1–5 分 · 1 分进入 Bad Case / 改进队列
                    </p>
                    {ratingError ? (
                      <p className="text-[10px] text-red-700">{ratingError}</p>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </CardContent>

        <div className="demo-composer">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              sessionClosed
                ? '本次会话已结束，点击清空开始新会话'
                : '输入客服问题…'
            }
            className="min-h-[56px] resize-none"
            disabled={running || sessionClosed}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendQuestion();
              }
            }}
          />
          <Button
            type="button"
            className="demo-send-button"
            size="icon"
            onClick={() => void sendQuestion()}
            disabled={running || sessionClosed || !input.trim()}
            aria-label="发送消息"
          >
            {running ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <Send aria-hidden />
            )}
          </Button>
        </div>
      </Card>

      <p className="page-note">
        简单聊天与服务端工作台共享 <code>POST /api/agent/run</code>；评分保存到 <code>/api/ratings</code>，1 分同时进入改进队列；课堂演示也会执行真实 Tool 和风险审核。
      </p>
    </div>
  );
}
