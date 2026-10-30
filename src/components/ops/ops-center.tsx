'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Download,
  FlaskConical,
  GitBranch,
  History,
  Lightbulb,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Star,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/client';
import type {
  AbTest,
  AbTestsResponse,
  Annotation,
  AnnotationListResponse,
  AnnotationPromoteResponse,
  ImprovementCenterResponse,
  ImprovementCluster,
  ImprovementDirection,
  OpsOverview,
  PromptVersionCreateResponse,
  PromptDraftResponse,
  Rating,
  RatingsResponse,
  SkillSummary,
  SkillVersionSummary,
  SkillVersionsResponse,
  SkillDetailResponse,
  SkillsResponse,
} from '@/lib/types';

type TabKey = 'monitor' | 'ratings' | 'manual-eval' | 'annotations' | 'improvements' | 'rollback' | 'ab-tests';
type DraftSource = { clusterId?: string; improvementId?: string };
type DimensionKey = 'correctness' | 'relevance' | 'completeness' | 'safety' | 'tone' | 'overall';
type AnnotationStatus = 'pending' | 'accepted' | 'rejected' | 'evaluating';

const TABS: { key: TabKey; label: string; icon: typeof Activity }[] = [
  { key: 'monitor', label: '运行监控', icon: Activity },
  { key: 'ratings', label: '服务评分', icon: Star },
  { key: 'manual-eval', label: '人工评估', icon: CheckCircle2 },
  { key: 'annotations', label: '数据标注', icon: ClipboardCheck },
  { key: 'improvements', label: '改进建议', icon: Lightbulb },
  { key: 'rollback', label: '版本回滚', icon: RotateCcw },
  { key: 'ab-tests', label: 'Prompt A/B', icon: GitBranch },
];
const QUESTION_TYPES = ['价格优惠', '订单物流', '售后', '过敏安全', '投诉', '诈骗', '商品推荐', '其他', '未分类'];
const DIMENSIONS: { key: DimensionKey; label: string }[] = [
  { key: 'correctness', label: '正确性' },
  { key: 'relevance', label: '相关性' },
  { key: 'completeness', label: '完整性' },
  { key: 'safety', label: '安全性' },
  { key: 'tone', label: '语气' },
  { key: 'overall', label: '综合' },
];

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init });
  const payload = (await response.json().catch(() => null)) as { error?: string } | T | null;
  if (!response.ok) {
    throw new Error((payload as { error?: string } | null)?.error ?? `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : '请求失败，请稍后重试';
}

function scoreTone(score: number): BadgeTone {
  return score <= 2 ? 'danger' : score === 3 ? 'warning' : 'success';
}
function statusTone(status: string): BadgeTone {
  if (['成功', 'accepted', '已完成'].includes(status)) return 'success';
  if (['失败', 'rejected'].includes(status)) return 'danger';
  if (['转人工', 'pending', '进行中', 'evaluating'].includes(status)) return 'warning';
  return 'neutral';
}
function riskTone(level: string): BadgeTone {
  return level === 'high' ? 'danger' : level === 'medium' ? 'warning' : level === 'low' ? 'success' : 'neutral';
}
function directionTone(direction: ImprovementDirection): BadgeTone {
  return direction === 'Planner' ? 'accent' : direction === 'Skill' ? 'warning' : direction === 'Tool' ? 'neutral' : 'success';
}
function sourceLabel(sourceType: ImprovementCluster['sourceType']): string {
  return sourceType === 'low-rating'
    ? '低评分'
    : sourceType === 'low-annotation'
      ? '低分标注'
      : sourceType === 'eval-failure'
        ? 'Eval 失败'
        : 'Bad Case';
}
function splitTags(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function originLabel(origin: Annotation['origin']): string {
  if (origin === 'bad-case') return 'Bad Case 人工评估';
  if (origin === 'low-rating') return '低评分人工评估';
  if (origin === 'low-annotation') return '低分标注人工评估';
  if (origin === 'run-followup') return 'Run 标注人工跟进';
  if (origin === 'bad-case-evaluation') return 'Bad Case 人工评估入队';
  if (origin === 'low-rating-evaluation') return '低评分人工评估入队';
  if (origin === 'low-annotation-evaluation') return '低分标注人工评估入队';
  if (origin === 'run-followup-evaluation') return 'Run 标注人工跟进入队';
  return '人工标注';
}
function originTone(origin: Annotation['origin']): BadgeTone {
  if (origin === 'bad-case' || origin === 'bad-case-evaluation') return 'danger';
  if (origin === 'low-rating' || origin === 'low-rating-evaluation') return 'warning';
  if (origin === 'low-annotation' || origin === 'low-annotation-evaluation') return 'accent';
  if (origin === 'run-followup' || origin === 'run-followup-evaluation') return 'warning';
  return 'neutral';
}
function savedAnnotationOrigin(origin: Annotation['origin']): Annotation['origin'] {
  if (origin === 'bad-case') return 'bad-case-evaluation';
  if (origin === 'low-rating') return 'low-rating-evaluation';
  if (origin === 'low-annotation') return 'low-annotation-evaluation';
  if (origin === 'run-followup') return 'run-followup-evaluation';
  return origin;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
function buildQuery(input: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
function runLink(runId: string) {
  return `/runs/${runId}`;
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[11px] leading-5 text-red-900">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{message}，页面其他区域仍可独立使用。</span>
    </div>
  );
}
function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="text-xs font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[11px] leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}
function Kpi({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint: string; tone?: BadgeTone }) {
  return (
    <div className="ops-kpi">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <span className={`size-1.5 rounded-full ${tone === 'danger' ? 'bg-red-500' : tone === 'warning' ? 'bg-amber-500' : tone === 'success' ? 'bg-emerald-500' : 'bg-stone-400'}`} />
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{hint}</p>
    </div>
  );
}

function RatingCard({ rating }: { rating: Rating }) {
  return (
    <div className="rounded-lg border bg-card px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={scoreTone(rating.score)}>{rating.score} 分</Badge>
          <Badge tone="neutral">{rating.questionType}</Badge>
          <Badge tone="neutral">{rating.source === 'demo' ? '零食小助手' : rating.source === 'agent' ? 'Agent 工作台' : rating.source === 'chat' ? '聊天评分' : rating.source === 'ops' ? '运营补录' : 'API'}</Badge>
          {rating.score <= 2 ? <Badge tone="danger">低分样本</Badge> : null}
        </div>
        <span className="text-[10px] text-muted-foreground">{formatDateTime(rating.createdAt)}</span>
      </div>
      <div className="mt-2 grid gap-1.5 text-[11px] leading-5 sm:grid-cols-2">
        <div><p className="agent-label">问题</p><p className="mt-0.5">{rating.question || '未保存问题文本'}</p></div>
        <div><p className="agent-label">回复</p><p className="mt-0.5 text-muted-foreground">{rating.answer || '未保存回复文本'}</p></div>
      </div>
      {rating.comment ? <p className="mt-2 text-[10px] text-muted-foreground">备注：{rating.comment}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link href={runLink(rating.runId)} className="text-[10px] font-medium text-primary hover:underline">查看关联 Run <ArrowRight className="inline size-3" aria-hidden /></Link>
        {rating.score <= 2 ? <span className="text-[10px] text-amber-800">低分已进入人工评估队列。</span> : null}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground">
          完整会话过程（{rating.conversation.length} 条）
        </summary>
        <div className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-2">
          {rating.conversation.map((message, index) => (
            <div key={`${message.role}-${index}`} className="text-[10px] leading-5">
              <span className={`mr-1 font-semibold ${message.role === 'user' ? 'text-foreground' : 'text-primary'}`}>{message.role === 'user' ? '用户' : '客服'}</span>
              <span className="text-muted-foreground">{message.content}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

type AnnotationPatch = {
  question: string;
  answer: string;
  expectedReply: string;
  intent: string;
  riskLevel: Annotation['riskLevel'];
  qualityTags: string[];
  requiredSkills: string[];
  expectedToolFacts: string[];
  forbiddenPhrases: string[];
  failureReason: string;
  note: string;
  dimensionNotes: Record<string, string>;
  correctness: number;
  relevance: number;
  completeness: number;
  safety: number;
  tone: number;
  overall: number;
};

function AnnotationQueueCard({
  annotation,
  mode,
  onSave,
  onStatus,
  onPromote,
  onSaveAsAnnotation,
}: {
  annotation: Annotation;
  mode: 'evaluation' | 'annotation';
  onSave: (patch: AnnotationPatch) => Promise<void>;
  onStatus?: (status: AnnotationStatus) => void;
  onPromote?: (target: 'improvement' | 'eval') => void;
  onSaveAsAnnotation?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(annotation.question);
  const [answer, setAnswer] = useState(annotation.answer);
  const [expectedReply, setExpectedReply] = useState(annotation.expectedReply);
  const [intent, setIntent] = useState(annotation.intent);
  const [riskLevel, setRiskLevel] = useState<Annotation['riskLevel']>(annotation.riskLevel);
  const [qualityTags, setQualityTags] = useState(annotation.qualityTags.join(', '));
  const [requiredSkills, setRequiredSkills] = useState(annotation.requiredSkills.join(', '));
  const [expectedToolFacts, setExpectedToolFacts] = useState(annotation.expectedToolFacts.join(', '));
  const [forbiddenPhrases, setForbiddenPhrases] = useState(annotation.forbiddenPhrases.join(', '));
  const [failureReason, setFailureReason] = useState(annotation.failureReason);
  const [note, setNote] = useState(annotation.note);
  const [scores, setScores] = useState<Record<DimensionKey, number>>({
    correctness: annotation.correctness,
    relevance: annotation.relevance,
    completeness: annotation.completeness,
    safety: annotation.safety,
    tone: annotation.tone,
    overall: annotation.overall,
  });
  const [dimensionNotes, setDimensionNotes] = useState<Record<string, string>>(annotation.dimensionNotes);
  const [saving, setSaving] = useState(false);

  function patch(): AnnotationPatch {
    return {
      question,
      answer,
      expectedReply,
      intent,
      riskLevel,
      qualityTags: splitTags(qualityTags),
      requiredSkills: splitTags(requiredSkills),
      expectedToolFacts: splitTags(expectedToolFacts),
      forbiddenPhrases: splitTags(forbiddenPhrases),
      failureReason,
      note,
      dimensionNotes,
      ...scores,
    };
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(patch());
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveAsAnnotation() {
    if (saving || !onSaveAsAnnotation) return;
    setSaving(true);
    try {
      await onSave(patch());
      await onSaveAsAnnotation();
    } finally {
      setSaving(false);
    }
  }

  const accepted = annotation.status === 'accepted';
  const promotedImprovement = Boolean(annotation.promotedImprovementId);
  const promotedEvalCase = Boolean(annotation.promotedEvalCaseId);

  return (
    <div className="rounded-lg border bg-card px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={originTone(annotation.origin)}>{originLabel(annotation.origin)}</Badge>
          <Badge tone={statusTone(annotation.status)}>{annotation.status}</Badge>
          <Badge tone="neutral">{annotation.target === 'reply' ? '回复标注' : 'Run 标注'}</Badge>
          {promotedImprovement ? <Badge tone="success">已进入改进</Badge> : null}
          {promotedEvalCase ? <Badge tone="success">已进入评测集</Badge> : null}
          <span className="text-xs font-semibold">{annotation.label}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {annotation.annotator} · {formatDateTime(annotation.updatedAt ?? annotation.createdAt)}
        </span>
      </div>

      <div className="mt-2 grid gap-2 text-[11px] leading-5 lg:grid-cols-3">
        <div><p className="agent-label">客户问题</p><p className="mt-0.5">{question || '未记录问题'}</p></div>
        <div><p className="agent-label">模型回复</p><p className="mt-0.5 text-muted-foreground">{answer || '未记录回复'}</p></div>
        <div><p className="agent-label">发现的问题</p><p className="mt-0.5 text-muted-foreground">{failureReason || annotation.qualityTags.join('、') || '待人工复核'}</p></div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {DIMENSIONS.map((dimension) => (
          <div key={dimension.key} className="rounded-md bg-muted/60 px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground">{dimension.label}</p>
            <p className="mt-0.5 text-xs font-semibold">{scores[dimension.key]}/5</p>
            {dimensionNotes[dimension.key] ? <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{dimensionNotes[dimension.key]}</p> : null}
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button type="button" className="text-[10px] font-medium text-primary hover:underline" onClick={() => setOpen((current) => !current)}>{open ? '收起' : mode === 'evaluation' ? '展开评估' : '展开标注'}</button>
        <Link href={runLink(annotation.runId)} className="text-[10px] text-primary hover:underline">查看 Run <ArrowRight className="inline size-3" aria-hidden /></Link>
        <span className="ml-auto" />
        {mode === 'evaluation' ? (
          <Button type="button" size="sm" onClick={() => void saveAsAnnotation()} disabled={saving}>{saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <ClipboardCheck aria-hidden />}{saving ? '保存中…' : '保存为标注'}</Button>
        ) : (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => onStatus?.('accepted')} disabled={annotation.status === 'accepted'}><CheckCircle2 aria-hidden /> 接受</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onStatus?.('rejected')} disabled={annotation.status === 'rejected'}><XCircle aria-hidden /> 拒绝</Button>
            <Button type="button" size="sm" variant="outline" className={promotedImprovement ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : undefined} onClick={() => onPromote?.('improvement')} disabled={!accepted || promotedImprovement}>{promotedImprovement ? <CheckCircle2 aria-hidden /> : <Lightbulb aria-hidden />} {promotedImprovement ? '已进入改进' : '进入改进'}</Button>
            <Button type="button" size="sm" variant="outline" className={promotedEvalCase ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : undefined} onClick={() => onPromote?.('eval')} disabled={!accepted || promotedEvalCase}>{promotedEvalCase ? <CheckCircle2 aria-hidden /> : <FlaskConical aria-hidden />} {promotedEvalCase ? '已进入评测集' : '进入评测集'}</Button>
          </>
        )}
      </div>
      {mode === 'annotation' && !accepted ? <p className="mt-1 text-[9px] text-muted-foreground">只有先点击“接受”，才可进入改进建议或评测集。</p> : null}
      {mode === 'annotation' && accepted && (promotedImprovement || promotedEvalCase) ? <p className="mt-1 text-[9px] text-emerald-800">已完成：{promotedImprovement ? '改进建议' : ''}{promotedImprovement && promotedEvalCase ? '、' : ''}{promotedEvalCase ? '评测集' : ''}。重复点击不会再创建副本。</p> : null}

      {open ? (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="grid gap-2 lg:grid-cols-3">
            <label className="text-[10px] text-muted-foreground">客户问题<Textarea className="mt-1" rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
            <label className="text-[10px] text-muted-foreground">模型回复<Textarea className="mt-1" rows={3} value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>
            <label className="text-[10px] text-muted-foreground">人工期望回复<Textarea className="mt-1" rows={3} value={expectedReply} onChange={(event) => setExpectedReply(event.target.value)} placeholder="填写期望客服回复" /></label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[10px] text-muted-foreground">意图标签<Input className="mt-1" value={intent} onChange={(event) => setIntent(event.target.value)} /></label>
            <label className="text-[10px] text-muted-foreground">风险等级<select className="field-select mt-1" value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as Annotation['riskLevel'])}><option value="none">none</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
            <label className="text-[10px] text-muted-foreground">质量标签（逗号分隔）<Input className="mt-1" value={qualityTags} onChange={(event) => setQualityTags(event.target.value)} placeholder="如：事实错误, 价格不一致" /></label>
            <label className="text-[10px] text-muted-foreground">必经 Skill（逗号分隔）<Input className="mt-1" value={requiredSkills} onChange={(event) => setRequiredSkills(event.target.value)} placeholder="skill:need-extraction, skill:risk-check" /></label>
            <label className="text-[10px] text-muted-foreground">期望 Tool 事实（逗号分隔）<Input className="mt-1" value={expectedToolFacts} onChange={(event) => setExpectedToolFacts(event.target.value)} placeholder="真实价格、物流状态、库存" /></label>
            <label className="text-[10px] text-muted-foreground">禁用表述（逗号分隔）<Input className="mt-1" value={forbiddenPhrases} onChange={(event) => setForbiddenPhrases(event.target.value)} placeholder="保证, 百分百, 绝对" /></label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[10px] text-muted-foreground">人工备注<Textarea className="mt-1" rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <label className="text-[10px] text-muted-foreground">失败原因 / 发现的问题<Textarea className="mt-1" rows={2} value={failureReason} onChange={(event) => setFailureReason(event.target.value)} /></label>
          </div>
          <div>
            <p className="agent-label">六维质量标注 + 分别备注</p>
            <div className="mt-1 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {DIMENSIONS.map((dimension) => (
                <div key={dimension.key} className="rounded-md border px-2 py-1.5">
                  <div className="flex items-center gap-2"><span className="text-[10px] font-medium">{dimension.label}</span><select className="field-select ml-auto h-7 w-14 px-1 text-[10px]" value={scores[dimension.key]} onChange={(event) => setScores((current) => ({ ...current, [dimension.key]: Number(event.target.value) }))} aria-label={`${dimension.label}评分`}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
                  <Input className="mt-1 h-7 text-[10px]" value={dimensionNotes[dimension.key] ?? ''} onChange={(event) => setDimensionNotes((current) => ({ ...current, [dimension.key]: event.target.value }))} placeholder="该维度备注" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end"><Button type="button" size="sm" onClick={() => void save()} disabled={saving}>{saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <ClipboardCheck aria-hidden />}{saving ? '保存中…' : mode === 'evaluation' ? '保存评估字段' : '保存标注字段'}</Button></div>
        </div>
      ) : null}
    </div>
  );
}

function ClusterCard({ cluster, onDraft, busy }: { cluster: ImprovementCluster; onDraft: () => void; busy: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            {cluster.ruleCluster ? <Badge tone="warning">规则聚类</Badge> : <Badge tone="neutral">Eval 预留</Badge>}
            <Badge tone="neutral">{sourceLabel(cluster.sourceType)}</Badge>
            <Badge tone={cluster.priority === '高' ? 'danger' : 'warning'}>{cluster.priority}优先级</Badge>
            <Badge tone={directionTone(cluster.primaryDirection)}>{cluster.primaryDirection}</Badge>
          </div>
          <p className="mt-2 text-xs font-semibold">{cluster.title}</p>
          <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{cluster.description}</p>
        </div>
        <div className="text-right"><p className="text-lg font-semibold">{cluster.count}</p><p className="text-[9px] text-muted-foreground">样本数</p></div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-7">
        {DIMENSIONS.map((dimension) => (
          <div key={dimension.key} className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground">{dimension.label}均分</p>
            <p className="mt-0.5 text-xs font-semibold">{cluster.dimensionAverages[dimension.key] ?? '—'}</p>
          </div>
        ))}
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-center">
          <p className="text-[9px] text-amber-800">用户评分</p>
          <p className="mt-0.5 text-xs font-semibold text-amber-900">{cluster.userRatingAverage ?? '—'}{cluster.userRatingCount > 0 ? ` (${cluster.userRatingCount})` : ''}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {cluster.sampleRuns.length === 0 ? <span className="text-[10px] text-muted-foreground">暂无样本 Run</span> : cluster.sampleRuns.map((sample) => (
          <Link key={sample.id} href={runLink(sample.id)} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground">{sample.id.slice(0, 18)} · {sample.status}</Link>
        ))}
      </div>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {cluster.directions.map((item) => (
          <div key={item.direction} className="rounded-md border border-border/70 px-2 py-1.5">
            <span className="text-[9px] font-semibold text-muted-foreground">{item.direction}</span>
            <p className="mt-0.5 text-[10px] leading-4 text-foreground/80">{item.recommendation}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-end gap-2">
        <p className="mr-auto max-w-[560px] text-[10px] leading-4 text-muted-foreground">点击“生成 Prompt 草案”只创建版本，不立即应用；会自动进入 Prompt A/B 并生成一条实验草稿（A=原版本，B=新版本），确认后才正式应用。</p>
        <Button type="button" size="sm" variant="outline" onClick={onDraft} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}{busy ? '生成中…' : '生成 Prompt 草案'}</Button>
      </div>
    </div>
  );
}


export function OpsCenter() {
  const [tab, setTab] = useState<TabKey>('monitor');
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [ratingStats, setRatingStats] = useState<{ total: number; averageScore: number; onePointCount: number } | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [improvements, setImprovements] = useState<ImprovementCenterResponse | null>(null);
  const [abTests, setAbTests] = useState<AbTest[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftLoading, setDraftLoading] = useState<string | null>(null);
  const [draftConfirm, setDraftConfirm] = useState<{ source: DraftSource; skillId?: string } | null>(null);
  const [draftPreview, setDraftPreview] = useState<PromptDraftResponse | null>(null);
  const [draftPreviewLoading, setDraftPreviewLoading] = useState(false);
  const [draftPreviewError, setDraftPreviewError] = useState<string | null>(null);
  const [rollbackSkillId, setRollbackSkillId] = useState('');
  const [rollbackVersions, setRollbackVersions] = useState<SkillVersionSummary[]>([]);
  const [rollbackVersionId, setRollbackVersionId] = useState('');
  const [rollbackPending, setRollbackPending] = useState(false);
  const [abSaving, setAbSaving] = useState(false);

  const [ratingFilters, setRatingFilters] = useState({ from: '', to: '', score: '', questionType: '' });
  const [annotationFilter, setAnnotationFilter] = useState('');
  const [annotationOrigin, setAnnotationOrigin] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importSaving, setImportSaving] = useState(false);
  const [newAnnotationOpen, setNewAnnotationOpen] = useState(false);
  const [newAnnotationForm, setNewAnnotationForm] = useState({
    runId: '', label: '人工新增标注', question: '', answer: '', expectedReply: '',
    intent: '', qualityTags: '', requiredSkills: '', expectedToolFacts: '',
    forbiddenPhrases: '', failureReason: '', note: '', annotator: '运营管理员',
  });
  const [newAnnotationSaving, setNewAnnotationSaving] = useState(false);

  const [abForm, setAbForm] = useState({
    name: '',
    skillId: '',
    promptA: '',
    promptB: '',
    trafficA: '50',
    trafficB: '50',
    enabledA: true,
    enabledB: true,
  });
  const [editingAb, setEditingAb] = useState<AbTest | null>(null);
  const [abConfirming, setAbConfirming] = useState<string | null>(null);
  const [abEditSaving, setAbEditSaving] = useState(false);
  const [abSkillLoading, setAbSkillLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const results = await Promise.allSettled([
        fetchJson<OpsOverview>('/api/ops'),
        fetchJson<RatingsResponse>('/api/ratings'),
        fetchJson<AnnotationListResponse>('/api/annotations'),
        fetchJson<ImprovementCenterResponse>('/api/improvements'),
        fetchJson<AbTestsResponse>('/api/ab-tests'),
        fetchJson<SkillsResponse>('/api/skills'),
      ]);
      if (!active) return;
      const nextErrors: Record<string, string> = {};
      const [overviewResult, ratingsResult, annotationsResult, improvementsResult, abResult, skillsResult] = results;
      if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value); else nextErrors.overview = errorText(overviewResult.reason);
      if (ratingsResult.status === 'fulfilled') { setRatings(ratingsResult.value.ratings); setRatingStats(ratingsResult.value.stats); } else nextErrors.ratings = errorText(ratingsResult.reason);
      if (annotationsResult.status === 'fulfilled') setAnnotations(annotationsResult.value.annotations); else nextErrors.annotations = errorText(annotationsResult.reason);
      if (improvementsResult.status === 'fulfilled') setImprovements(improvementsResult.value); else nextErrors.improvements = errorText(improvementsResult.reason);
      if (abResult.status === 'fulfilled') setAbTests(abResult.value.abTests); else nextErrors.abTests = errorText(abResult.reason);
      if (skillsResult.status === 'fulfilled') setSkills(skillsResult.value.skills); else nextErrors.skills = errorText(skillsResult.reason);
      setErrors(nextErrors);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  function clearError(key: string) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function refreshOverview() {
    try { setOverview(await fetchJson<OpsOverview>('/api/ops')); clearError('overview'); }
    catch (caught) { setErrors((current) => ({ ...current, overview: errorText(caught) })); }
  }
  async function loadRatings(filters = ratingFilters) {
    try {
      const query = buildQuery({ from: filters.from, to: filters.to ? `${filters.to}T23:59:59` : undefined, score: filters.score, questionType: filters.questionType });
      const data = await fetchJson<RatingsResponse>(`/api/ratings${query}`);
      setRatings(data.ratings);
      setRatingStats(data.stats);
      clearError('ratings');
    } catch (caught) { setErrors((current) => ({ ...current, ratings: errorText(caught) })); }
  }
  async function loadAnnotations() {
    try {
      const data = await fetchJson<AnnotationListResponse>('/api/annotations');
      setAnnotations(data.annotations); clearError('annotations');
    } catch (caught) { setErrors((current) => ({ ...current, annotations: errorText(caught) })); }
  }
  async function refreshImprovements() {
    try { setImprovements(await fetchJson<ImprovementCenterResponse>('/api/improvements')); clearError('improvements'); }
    catch (caught) { setErrors((current) => ({ ...current, improvements: errorText(caught) })); }
  }
  async function refreshAbTests() {
    try { const data = await fetchJson<AbTestsResponse>('/api/ab-tests'); setAbTests(data.abTests); clearError('abTests'); }
    catch (caught) { setErrors((current) => ({ ...current, abTests: errorText(caught) })); }
  }
  async function refreshSkills() {
    try { const data = await fetchJson<SkillsResponse>('/api/skills'); setSkills(data.skills); clearError('skills'); }
    catch (caught) { setErrors((current) => ({ ...current, skills: errorText(caught) })); }
  }
  async function refreshAll() {
    setRefreshing(true);
    await Promise.allSettled([refreshOverview(), loadRatings(), loadAnnotations(), refreshImprovements(), refreshAbTests(), refreshSkills()]);
    setRefreshing(false);
    toast.success('运营数据已刷新');
  }

  const questionTypes = [...new Set([...QUESTION_TYPES, ...ratings.map((rating) => rating.questionType)])];

  async function updateAnnotationStatus(id: string, status: AnnotationStatus) {
    try {
      await fetchJson<{ annotation: Annotation }>(`/api/annotations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      toast.success(`标注状态已更新为 ${status}`);
      await Promise.all([loadAnnotations(), refreshOverview()]);
    } catch (caught) { toast.error('标注状态更新失败', { description: errorText(caught) }); }
  }

  async function saveAnnotationFields(id: string, patch: AnnotationPatch) {
    try {
      const data = await fetchJson<{ annotation: Annotation }>(`/api/annotations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setAnnotations((current) => current.map((annotation) => (annotation.id === id ? data.annotation : annotation)));
      toast.success('标注字段已保存');
      await refreshOverview();
    } catch (caught) {
      toast.error('标注保存失败', { description: errorText(caught) });
      throw caught;
    }
  }

  async function saveEvaluationAsAnnotation(annotation: Annotation) {
    try {
      const data = await fetchJson<{ annotation: Annotation }>(`/api/annotations/${annotation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'pending',
          origin: savedAnnotationOrigin(annotation.origin),
        }),
      });
      setAnnotations((current) => current.map((item) => (item.id === annotation.id ? data.annotation : item)));
      toast.success('已保存为待标注数据', { description: originLabel(data.annotation.origin) });
      await Promise.all([loadAnnotations(), refreshOverview()]);
    } catch (caught) {
      toast.error('保存为标注失败', { description: errorText(caught) });
      throw caught;
    }
  }

  async function importBadCases() {
    if (importSaving) return;
    setImportSaving(true);
    try {
      const text = importText.trim();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = { items: text.split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
      }
      const items = Array.isArray(raw) ? raw : (raw as { items?: unknown[] }).items ?? [];
      await postJson<{ created: number }>('/api/annotations/import', { items });
      toast.success(`已导入 ${items.length} 条 Bad Case`);
      setImportText('');
      setImportOpen(false);
      await Promise.all([loadAnnotations(), refreshOverview()]);
    } catch (caught) {
      toast.error('导入 Bad Case 失败', { description: errorText(caught) });
    } finally {
      setImportSaving(false);
    }
  }

  async function createAnnotationManual() {
    if (newAnnotationSaving) return;
    setNewAnnotationSaving(true);
    try {
      await postJson<{ annotation: Annotation }>('/api/annotations', {
        runId: newAnnotationForm.runId,
        label: newAnnotationForm.label,
        status: 'pending',
        question: newAnnotationForm.question || undefined,
        answer: newAnnotationForm.answer || undefined,
        expectedReply: newAnnotationForm.expectedReply,
        intent: newAnnotationForm.intent || undefined,
        qualityTags: splitTags(newAnnotationForm.qualityTags),
        requiredSkills: splitTags(newAnnotationForm.requiredSkills),
        expectedToolFacts: splitTags(newAnnotationForm.expectedToolFacts),
        forbiddenPhrases: splitTags(newAnnotationForm.forbiddenPhrases),
        failureReason: newAnnotationForm.failureReason,
        note: newAnnotationForm.note,
        annotator: newAnnotationForm.annotator,
      });
      toast.success('标注已新增');
      setNewAnnotationOpen(false);
      setNewAnnotationForm({ ...newAnnotationForm, expectedReply: '', failureReason: '', note: '', qualityTags: '', requiredSkills: '', expectedToolFacts: '', forbiddenPhrases: '' });
      await Promise.all([loadAnnotations(), refreshOverview()]);
    } catch (caught) {
      toast.error('新增标注失败', { description: errorText(caught) });
    } finally {
      setNewAnnotationSaving(false);
    }
  }

  async function promoteAnnotation(id: string, target: 'improvement' | 'eval') {
    try {
      const result = await postJson<AnnotationPromoteResponse>(`/api/annotations/${id}/promote`, { target });
      toast.success(target === 'eval' ? '已进入评测集' : '已进入改进建议', { description: target === 'eval' ? result.evalCase?.name : result.improvement?.title });
      await Promise.all([loadAnnotations(), refreshImprovements(), refreshOverview()]);
    } catch (caught) { toast.error('标注转存失败', { description: errorText(caught) }); }
  }

  async function requestDraft(source: DraftSource, skillId?: string) {
    setDraftConfirm({ source, ...(skillId ? { skillId } : {}) });
    setDraftPreview(null);
    setDraftPreviewError(null);
    setDraftPreviewLoading(true);
    try {
      const result = await postJson<PromptDraftResponse>('/api/improvements/preview-prompt', {
        ...source,
        ...(skillId ? { skillId } : {}),
      });
      if (result) setDraftPreview(result);
    } catch (caught) {
      setDraftPreviewError(errorText(caught));
    } finally {
      setDraftPreviewLoading(false);
    }
  }

  async function generateDraft(source: DraftSource, skillId?: string) {
    const key = source.clusterId ?? source.improvementId ?? 'draft';
    setDraftLoading(key);
    try {
      const data = await postJson<PromptVersionCreateResponse>('/api/improvements/create-version', {
        ...source,
        ...(skillId ? { skillId } : {}),
        changeNote: `规则改进：${source.clusterId ?? source.improvementId ?? 'Skill Prompt'}`,
      });
      setDraftConfirm(null);
      setDraftPreview(null);
      toast.success('已创建版本与 A/B 草稿', {
        description: `${data.draft.skill.name} · A v${data.abTest.baseVersion ?? data.draft.skill.version} / B v${data.version.version}；尚未应用，确认后生效。`,
      });
      await Promise.all([refreshImprovements(), refreshAbTests(), refreshSkills(), refreshOverview()]);
      setTab('ab-tests');
    } catch (caught) { toast.error('创建版本或 A/B 草稿失败', { description: errorText(caught) }); }
    finally { setDraftLoading(null); }
  }


  async function chooseRollbackSkill(skillId: string) {
    setRollbackSkillId(skillId); setRollbackVersionId(''); setRollbackVersions([]);
    if (!skillId) return;
    try {
      const data = await fetchJson<SkillVersionsResponse>(`/api/skills/${encodeURIComponent(skillId)}/versions`);
      setRollbackVersions(data.versions);
    } catch (caught) { toast.error('版本列表读取失败', { description: errorText(caught) }); }
  }

  async function rollbackVersion() {
    if (!rollbackSkillId || !rollbackVersionId || rollbackPending) return;
    setRollbackPending(true);
    try {
      const result = await postJson<{ skill: { version: string } }>(`/api/skills/${encodeURIComponent(rollbackSkillId)}/rollback`, { versionId: rollbackVersionId });
      toast.success(`已回滚并创建新版本 ${result.skill.version}`, { description: '旧正文已恢复，回滚动作本身也保留版本快照。' });
      await Promise.all([refreshSkills(), chooseRollbackSkill(rollbackSkillId), refreshImprovements()]);
    } catch (caught) { toast.error('版本回滚失败', { description: errorText(caught) }); }
    finally { setRollbackPending(false); }
  }

  async function loadAbSkillPrompt(skillId: string, mode: 'create' | 'edit') {
    if (!skillId) return;
    setAbSkillLoading(true);
    try {
      const data = await fetchJson<SkillDetailResponse>(`/api/skills/${encodeURIComponent(skillId)}`);
      if (mode === 'create') {
        setAbForm((current) => ({ ...current, skillId, promptA: data.skill.systemPrompt, promptB: data.skill.systemPrompt }));
      } else {
        setEditingAb((current) => current ? { ...current, skillId, promptA: data.skill.systemPrompt, promptB: data.skill.systemPrompt } : current);
      }
    } catch (caught) {
      toast.error('读取 Skill Prompt 失败', { description: errorText(caught) });
    } finally {
      setAbSkillLoading(false);
    }
  }

  function openAbEdit(test: AbTest) {
    setEditingAb({
      ...test,
      skillId: test.skillId ?? test.skillAId ?? test.skillBId,
      promptA: test.promptA ?? test.variantA,
      promptB: test.promptB ?? test.variantB,
    });
  }

  async function saveAbTestEdit() {
    if (!editingAb || abEditSaving) return;
    setAbEditSaving(true);
    try {
      await fetchJson<{ abTest: AbTest }>(`/api/ab-tests/${editingAb.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingAb.name,
          status: editingAb.status,
          skillId: editingAb.skillId || undefined,
          promptA: editingAb.promptA || undefined,
          promptB: editingAb.promptB || undefined,
          trafficA: editingAb.trafficA,
          trafficB: editingAb.trafficB,
          enabledA: editingAb.enabledA,
          enabledB: editingAb.enabledB,
        }),
      });
      toast.success('实验配置已保存');
      setEditingAb(null);
      await refreshAbTests();
    } catch (caught) {
      toast.error('实验保存失败', { description: errorText(caught) });
    } finally {
      setAbEditSaving(false);
    }
  }

  async function confirmAbDraft(id: string) {
    if (abConfirming) return;
    setAbConfirming(id);
    try {
      const result = await postJson<{ abTest: AbTest; skill: { name: string; version: string }; improvement: unknown }>(
        `/api/ab-tests/${encodeURIComponent(id)}/confirm`,
        {},
      );
      toast.success('A/B 草稿已确认并正式应用', {
        description: `${result.skill.name} 当前版本 v${result.skill.version}；实验状态：${result.abTest.status}`,
      });
      await Promise.all([refreshAbTests(), refreshSkills(), refreshImprovements(), refreshOverview()]);
    } catch (caught) {
      toast.error('A/B 确认应用失败', { description: errorText(caught) });
    } finally {
      setAbConfirming(null);
    }
  }

  async function createAbTest() {
    if (abSaving) return;
    setAbSaving(true);
    try {
      await postJson<{ abTest: AbTest }>('/api/ab-tests', {
        name: abForm.name,
        skillId: abForm.skillId,
        promptA: abForm.promptA,
        promptB: abForm.promptB,
        trafficA: Number(abForm.trafficA) || 0,
        trafficB: Number(abForm.trafficB) || 0,
        enabledA: abForm.enabledA,
        enabledB: abForm.enabledB,
      });
      toast.success('Prompt A/B 草稿已创建');
      setAbForm({ name: '', skillId: '', promptA: '', promptB: '', trafficA: '50', trafficB: '50', enabledA: true, enabledB: true });
      await refreshAbTests();
    } catch (caught) { toast.error('A/B 创建失败', { description: errorText(caught) }); }
    finally { setAbSaving(false); }
  }

  const annotationExportCsvHref = `/api/annotations/export${buildQuery({ status: annotationFilter, origin: annotationOrigin })}`;
  const annotationReviewJsonlHref = '/api/annotations/export?format=jsonl&scope=review';
  const annotationAllJsonlHref = '/api/annotations/export?format=jsonl&scope=all';

  function renderMonitor() {
    if (errors.overview) return <SectionError message={`运行监控加载失败：${errors.overview}`} />;
    if (!overview) return <EmptyState title="正在读取运行监控" description="正在聚合 RunRecord、失败步骤和风险分布。" />;
    const maxRisk = Math.max(1, ...overview.riskDistribution.map((item) => item.count));
    return (
      <div className="space-y-4">
        <div className="ops-kpi-grid">
          <Kpi label="运行总数" value={String(overview.totalRuns)} hint="全部已持久化 RunRecord" />
          <Kpi label="成功率" value={formatPercent(overview.successRate)} hint="状态为“成功”的运行占比" tone="success" />
          <Kpi label="平均耗时" value={formatDuration(overview.averageDurationMs)} hint="按 RunRecord durationMs 计算" />
          <Kpi label="失败步骤" value={String(overview.failedSteps)} hint="所有 ERROR Skill / Tool 步骤" tone={overview.failedSteps > 0 ? 'danger' : 'success'} />
          <Kpi label="人工接管率" value={formatPercent(overview.handoffRate)} hint="存在 handoff 记录的运行占比" tone="warning" />
          <Kpi label="待处理信号" value={`${overview.lowRatingCount} / ${overview.pendingEvaluationCount} / ${overview.pendingAnnotationCount}`} hint="低分 / 人工评估 / 待标注" tone={overview.lowRatingCount > 0 || overview.pendingEvaluationCount > 0 ? 'warning' : 'neutral'} />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1fr_1.15fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldAlert className="size-4 text-primary" aria-hidden />风险等级分布</CardTitle>
              <p className="text-[11px] leading-5 text-muted-foreground">来自持久化 RunRecord 的 risk-check 结果。</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.riskDistribution.map((item) => (
                <div key={item.level}>
                  <div className="flex items-center justify-between text-[10px]"><span className="font-medium">{item.level}</span><span className="text-muted-foreground">{item.count}</span></div>
                  <div className="ops-risk-track mt-1"><span className={`ops-risk-fill ${item.level === 'high' ? 'bg-red-500' : item.level === 'medium' ? 'bg-amber-500' : item.level === 'low' ? 'bg-emerald-500' : 'bg-stone-300'}`} style={{ width: `${(item.count / maxRisk) * 100}%` }} /></div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-primary" aria-hidden />失败步骤</CardTitle>
              <p className="text-[11px] leading-5 text-muted-foreground">点击 Run 打开完整 Trace。</p>
            </CardHeader>
            <CardContent>
              {overview.failedStepSamples.length === 0 ? <EmptyState title="暂无失败步骤" description="当前没有 ERROR 步骤。" /> : (
                <div className="space-y-2">
                  {overview.failedStepSamples.map((sample) => (
                    <Link key={`${sample.runId}-${sample.stepId}`} href={runLink(sample.runId)} className="block rounded-md border border-red-100 bg-red-50/60 px-2.5 py-2 hover:border-red-200">
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[10px] font-semibold text-red-900">{sample.capabilityId}</span><Badge tone="danger">ERROR</Badge></div>
                      <p className="mt-1 line-clamp-1 text-[10px] text-muted-foreground">{sample.question}</p>
                      <p className="mt-1 line-clamp-1 text-[10px] text-red-800">{sample.error ?? '未记录错误详情'}</p>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div><CardTitle className="flex items-center gap-2"><History className="size-4 text-primary" aria-hidden />最近运行</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">从运行结果进入标注、评分和改进。</p></div>
            <Button asChild variant="outline" size="sm"><Link href="/runs">全部运行 <ArrowRight aria-hidden /></Link></Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.recentRuns.length === 0 ? <EmptyState title="还没有运行记录" description="从 Agent 工作台发起第一轮任务后，这里会出现可追溯的 Run。" /> : overview.recentRuns.map((run) => (
              <Link key={run.id} href={runLink(run.id)} className="block rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5"><Badge tone={statusTone(run.status)}>{run.status}</Badge><Badge tone={riskTone(run.riskResult?.riskLevel ?? 'none')}>risk {run.riskResult?.riskLevel ?? 'none'}</Badge>{run.handoff ? <Badge tone="warning">人工接管</Badge> : null}</div>
                  <span className="text-[10px] text-muted-foreground">{formatDuration(run.durationMs)} · {formatDateTime(run.createdAt)}</span>
                </div>
                <p className="mt-1.5 line-clamp-1 text-[11px] font-medium">{run.question}</p>
                <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{run.finalReply ?? '暂无最终回复'}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderRatings() {
    return (
      <div className="space-y-4">
        {errors.ratings ? <SectionError message={`评分数据加载失败：${errors.ratings}`} /> : null}
        <div className="ops-kpi-grid">
          <Kpi label="评分总数" value={String(ratingStats?.total ?? ratings.length)} hint="Demo + Agent 用户评分" />
          <Kpi label="平均分" value={(ratingStats?.averageScore ?? 0).toFixed(1)} hint="全部评分均值" tone="success" />
          <Kpi label="1 分 Bad Case" value={String(ratingStats?.onePointCount ?? 0)} hint="最低分样本" tone={(ratingStats?.onePointCount ?? 0) > 0 ? 'danger' : 'success'} />
          <Kpi label="低分样本" value={String(ratings.filter((rating) => rating.score <= 2).length)} hint="当前筛选结果" tone="warning" />
          <Kpi label="完整会话" value={String(ratings.filter((rating) => rating.conversation.length > 0).length)} hint="已保存原始对话" />
          <Kpi label="来源" value="Demo / Agent" hint="用户评分入口" />
        </div>
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2"><Star className="size-4 text-primary" aria-hidden />筛选服务评分</CardTitle>
              <p className="text-[11px] leading-5 text-muted-foreground">按时间、评分、问题类型过滤；评分来自零食小助手和 Agent 工作台，问答对与完整会话随评分保存。</p>
            </div>
            <Badge tone="warning">1–2 分自动进入人工评估</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-[10px] text-muted-foreground">开始日期<Input type="date" value={ratingFilters.from} onChange={(event) => setRatingFilters((current) => ({ ...current, from: event.target.value }))} /></label>
              <label className="text-[10px] text-muted-foreground">结束日期<Input type="date" value={ratingFilters.to} onChange={(event) => setRatingFilters((current) => ({ ...current, to: event.target.value }))} /></label>
              <label className="text-[10px] text-muted-foreground">评分<select className="field-select mt-1" value={ratingFilters.score} onChange={(event) => setRatingFilters((current) => ({ ...current, score: event.target.value }))}><option value="">全部</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} 分</option>)}</select></label>
              <label className="text-[10px] text-muted-foreground">问题类型<select className="field-select mt-1" value={ratingFilters.questionType} onChange={(event) => setRatingFilters((current) => ({ ...current, questionType: event.target.value }))}><option value="">全部</option>{questionTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void loadRatings()}>应用筛选 <ArrowRight aria-hidden /></Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { const empty = { from: '', to: '', score: '', questionType: '' }; setRatingFilters(empty); void loadRatings(empty); }}>重置</Button>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-5 text-amber-900">低分（1–2 分）与失败 Run 会自动进入人工评估；写出期望回复后保存为数据标注。</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div><CardTitle>评分记录</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">{ratings.length} 条评分 · 问答对与 Run 关联保存</p></div>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadRatings()}><RefreshCw aria-hidden /> 刷新</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {ratings.length === 0 ? <EmptyState title="暂无评分" description="在零食小助手完成会话并评分后，这里会出现可筛选的评分记录。" /> : ratings.map((rating) => <RatingCard key={rating.id} rating={rating} />)}
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderAnnotations() {
    const dataAnnotations = annotations.filter((annotation) => annotation.status !== 'evaluating');
    const filtered = dataAnnotations.filter((annotation) => {
      if (annotationFilter && annotation.status !== annotationFilter) return false;
      if (annotationOrigin && annotation.origin !== annotationOrigin) return false;
      return true;
    });
    const pending = dataAnnotations.filter((annotation) => annotation.status === 'pending').length;
    const accepted = dataAnnotations.filter((annotation) => annotation.status === 'accepted').length;
    const rejected = dataAnnotations.filter((annotation) => annotation.status === 'rejected').length;
    return (
      <div className="space-y-4">
        {errors.annotations ? <SectionError message={`标注数据加载失败：${errors.annotations}`} /> : null}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-[11px] leading-5 text-amber-900">
          <div className="flex flex-wrap items-center gap-2 font-semibold"><ShieldAlert className="size-3.5" aria-hidden />标注流程</div>
          <p className="mt-1">运行 → Bad Case → 人工标注 → 审核 → Eval 回归。人工评估保存后会进入这里，状态从 pending 开始；只有接受后才能进入改进建议或评测集。</p>
        </div>
        <div className="ops-kpi-grid">
          <Kpi label="待标注" value={String(pending)} hint="pending" tone={pending > 0 ? 'warning' : 'success'} />
          <Kpi label="已接受" value={String(accepted)} hint="accepted" tone="success" />
          <Kpi label="已拒绝" value={String(rejected)} hint="rejected" tone="danger" />
          <Kpi label="标注总数" value={String(dataAnnotations.length)} hint="不含人工评估中的记录" />
          <Kpi label="JSONL" value="—" hint="审核 / 全部导出" />
          <Kpi label="导入" value="Bad Case" hint="JSON / JSONL" />
        </div>
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div><CardTitle className="flex items-center gap-2"><ClipboardCheck className="size-4 text-primary" aria-hidden />待标注数据</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">接受 / 拒绝 / 进入改进 / 进入评测集；未接受前后两个按钮不可用。</p></div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm"><a href={annotationReviewJsonlHref} download><Download aria-hidden /> 导出审核 JSONL</a></Button>
              <Button asChild variant="outline" size="sm"><a href={annotationAllJsonlHref} download><Download aria-hidden /> 导出全部 JSONL</a></Button>
              <Button asChild variant="outline" size="sm"><a href={annotationExportCsvHref} download><Download aria-hidden /> CSV</a></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[10px] text-muted-foreground">状态<select className="field-select mt-1" value={annotationFilter} onChange={(event) => setAnnotationFilter(event.target.value)}><option value="">全部</option><option value="pending">pending</option><option value="accepted">accepted</option><option value="rejected">rejected</option></select></label>
              <label className="text-[10px] text-muted-foreground">来源<select className="field-select mt-1" value={annotationOrigin} onChange={(event) => setAnnotationOrigin(event.target.value)}><option value="">全部</option><option value="manual">人工标注</option><option value="bad-case-evaluation">Bad Case 人工评估入队</option><option value="low-rating-evaluation">低评分人工评估入队</option><option value="low-annotation-evaluation">低分标注人工评估入队</option><option value="run-followup-evaluation">Run 标注人工跟进入队</option></select></label>
              <Button type="button" size="sm" variant="outline" onClick={() => void loadAnnotations()}><RefreshCw aria-hidden /> 刷新</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setImportOpen(true)}><Download aria-hidden /> 导入 Bad Case</Button>
              <Button type="button" size="sm" onClick={() => { const run = overview?.recentRuns[0]; setNewAnnotationForm((current) => ({ ...current, runId: run?.id ?? '', question: run?.question ?? '', answer: run?.finalReply ?? '' })); setNewAnnotationOpen(true); }}><ClipboardCheck aria-hidden /> + 新增标注</Button>
            </div>
            <div className="space-y-2">
              {filtered.length === 0 ? <EmptyState title="暂无待标注数据" description="在人工评估中保存为标注，或点击 + 新增标注。" /> : filtered.map((annotation) => (
                <AnnotationQueueCard
                  key={`${annotation.id}-${annotation.updatedAt ?? annotation.createdAt}`}
                  annotation={annotation}
                  mode="annotation"
                  onSave={(patch) => saveAnnotationFields(annotation.id, patch)}
                  onStatus={(status) => void updateAnnotationStatus(annotation.id, status)}
                  onPromote={(target) => void promoteAnnotation(annotation.id, target)}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Dialog open={importOpen} onOpenChange={setImportOpen} title="导入 Bad Case" description="支持 JSON 数组或 JSONL；每行必须包含 runId。导入后进入数据标注 pending。" className="max-w-2xl">
          <div className="space-y-3">
            <Textarea rows={8} value={importText} onChange={(event) => setImportText(event.target.value)} placeholder='[{"runId":"run-...","question":"...","answer":"...","expectedReply":"...","failureReason":"..."}]' />
            <p className="text-[10px] leading-5 text-muted-foreground">也支持每行一个 JSON 对象。导入使用 origin=bad-case-evaluation，便于与自动评估入队区分。</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setImportOpen(false)}>取消</Button><Button type="button" onClick={() => void importBadCases()} disabled={importSaving || !importText.trim()}>{importSaving ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />}{importSaving ? '导入中…' : '确认导入'}</Button></div>
          </div>
        </Dialog>

        <Dialog open={newAnnotationOpen} onOpenChange={setNewAnnotationOpen} title="新增标注" description="直接创建 pending 标注；也可以先在人工评估中沉淀。" className="max-w-3xl">
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[10px] text-muted-foreground">关联 Run<select className="field-select mt-1" value={newAnnotationForm.runId} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, runId: event.target.value }))}><option value="">选择 Run</option>{(overview?.recentRuns ?? []).map((run) => <option key={run.id} value={run.id}>{run.id} · {run.question.slice(0, 32)}</option>)}</select></label>
              <label className="text-[10px] text-muted-foreground">标签<Input className="mt-1" value={newAnnotationForm.label} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, label: event.target.value }))} /></label>
              <label className="text-[10px] text-muted-foreground">客户问题<Input className="mt-1" value={newAnnotationForm.question} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, question: event.target.value }))} /></label>
              <label className="text-[10px] text-muted-foreground">模型回复<Input className="mt-1" value={newAnnotationForm.answer} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, answer: event.target.value }))} /></label>
            </div>
            <label className="text-[10px] text-muted-foreground">期望回复<Textarea className="mt-1" rows={2} value={newAnnotationForm.expectedReply} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, expectedReply: event.target.value }))} /></label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={newAnnotationForm.intent} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, intent: event.target.value }))} placeholder="意图标签" />
              <Input value={newAnnotationForm.qualityTags} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, qualityTags: event.target.value }))} placeholder="质量标签（逗号分隔）" />
              <Input value={newAnnotationForm.requiredSkills} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, requiredSkills: event.target.value }))} placeholder="必经 Skill（逗号分隔）" />
              <Input value={newAnnotationForm.expectedToolFacts} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, expectedToolFacts: event.target.value }))} placeholder="期望 Tool 事实（逗号分隔）" />
              <Input value={newAnnotationForm.forbiddenPhrases} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, forbiddenPhrases: event.target.value }))} placeholder="禁用表述（逗号分隔）" />
              <Input value={newAnnotationForm.annotator} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, annotator: event.target.value }))} placeholder="标注人" />
            </div>
            <Textarea rows={2} value={newAnnotationForm.note} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, note: event.target.value }))} placeholder="人工备注" />
            <Textarea rows={2} value={newAnnotationForm.failureReason} onChange={(event) => setNewAnnotationForm((current) => ({ ...current, failureReason: event.target.value }))} placeholder="失败原因 / 发现的问题" />
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setNewAnnotationOpen(false)}>取消</Button><Button type="button" onClick={() => void createAnnotationManual()} disabled={newAnnotationSaving || !newAnnotationForm.runId}>{newAnnotationSaving ? <LoaderCircle className="animate-spin" aria-hidden /> : <ClipboardCheck aria-hidden />}{newAnnotationSaving ? '保存中…' : '保存标注'}</Button></div>
          </div>
        </Dialog>
      </div>
    );
  }

  function renderImprovements() {
    return (
      <div className="space-y-4">
        {errors.improvements ? <SectionError message={`改进建议加载失败：${errors.improvements}`} /> : null}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-[11px] leading-5 text-amber-900">
          <div className="flex flex-wrap items-center gap-2 font-semibold"><ShieldAlert className="size-3.5" aria-hidden />规则聚类，不是 LLM 分析</div>
          <p className="mt-1">只按低评分、低分标注、失败 Run、问题类型和失败步骤做确定性分组。点击生成后只创建待确认版本和 A/B 草稿，不会修改生产 Prompt；在 Prompt A/B 中确认后才正式应用。</p>
        </div>
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div><CardTitle className="flex items-center gap-2"><Lightbulb className="size-4 text-primary" aria-hidden />规则聚类</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">{(improvements?.clusters ?? []).length} 个聚类 · 覆盖 Planner / Skill / Tool / Eval 四类建议</p></div>
            <Button type="button" size="sm" variant="outline" onClick={() => void refreshImprovements()}><RefreshCw aria-hidden /> 重新聚类</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {(improvements?.clusters ?? []).length === 0 ? <EmptyState title="暂无规则聚类" description="低评分、低分标注或失败 Run 出现后，规则聚类会自动生成。" /> : (improvements?.clusters ?? []).map((cluster) => <ClusterCard key={cluster.id} cluster={cluster} busy={draftLoading === cluster.id} onDraft={() => void requestDraft({ clusterId: cluster.id })} />)}
          </CardContent>
        </Card>

        <Dialog
          open={draftConfirm !== null}
          onOpenChange={(open) => { if (!open) { setDraftConfirm(null); setDraftPreview(null); setDraftPreviewError(null); } }}
          title="创建版本并生成 Prompt A/B 草稿？"
          description="此操作只创建待确认版本和 A/B 草稿，不会修改当前生产 Prompt。"
          className="max-w-2xl"
        >
          <div className="space-y-3">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-950">
              <p className="font-semibold">确认后会执行以下动作：</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>根据当前改进建议生成 Prompt 草案；</li>
                <li>创建一个待确认的新 Skill 版本；</li>
                <li>自动进入 Prompt A/B；</li>
                <li>生成一条 A/B 实验草稿：A=原版本，B=新版本。</li>
              </ul>
              <p className="mt-1">当前 Skill 不会立即变化；只有你在 Prompt A/B 点击“确认应用”后才正式生效。</p>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground">
              来源：{draftConfirm?.source.clusterId ? `规则聚类 ${draftConfirm.source.clusterId}` : `改进建议 ${draftConfirm?.source.improvementId ?? ''}`}
            </div>

            {draftPreviewLoading ? <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-[10px] text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" aria-hidden />正在生成并计算 Prompt diff…</div> : null}
            {draftPreviewError ? <div role="alert" className="alert alert-danger"><AlertTriangle className="size-4 shrink-0" aria-hidden /><span>{draftPreviewError}</span></div> : null}
            {draftPreview ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <Badge tone="neutral">目标 Skill：{draftPreview.skill.name}</Badge>
                  <Badge tone="neutral">当前 v{draftPreview.skill.version}</Badge>
                  <Badge tone="success">+{draftPreview.stats.added} 行</Badge>
                  <Badge tone="danger">−{draftPreview.stats.removed} 行</Badge>
                  <span>{draftPreview.stats.unchanged} 行未变</span>
                </div>
                <div className="diff-block max-h-[320px] overflow-auto" aria-label="Prompt 修改 diff">
                  {draftPreview.diff.map((line, index) => (
                    <div key={`${index}-${line.type}`} className={`diff-line diff-${line.type}`}>
                      <span className="diff-line-no">{line.oldLine ?? ''}</span>
                      <span className="diff-line-no">{line.newLine ?? ''}</span>
                      <span className="diff-marker">{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</span>
                      <span className="diff-text">{line.text}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] leading-4 text-muted-foreground">diff 仅用于确认，点击取消不会写入版本或 A/B 草稿。</p>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setDraftConfirm(null); setDraftPreview(null); setDraftPreviewError(null); }}>取消</Button>
              <Button type="button" onClick={() => { if (draftConfirm) void generateDraft(draftConfirm.source, draftConfirm.skillId); }} disabled={!draftPreview || draftPreviewLoading || (draftConfirm !== null && draftLoading !== null)}>
                {draftLoading ? <LoaderCircle className="animate-spin" aria-hidden /> : <GitBranch aria-hidden />}
                {draftLoading ? '创建中…' : '确认创建并进入 Prompt A/B'}
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    );
  }

  function renderManualEvaluation() {
    const evaluations = annotations.filter((annotation) => annotation.status === 'evaluating');
    const badCases = evaluations.filter((annotation) => annotation.origin === 'bad-case').length;
    const lowRatings = evaluations.filter((annotation) => annotation.origin === 'low-rating').length;
    const lowAnnotations = evaluations.filter((annotation) => annotation.origin === 'low-annotation').length;
    const followups = evaluations.filter((annotation) => annotation.origin === 'run-followup').length;
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-[11px] leading-5 text-amber-900">
          <div className="flex flex-wrap items-center gap-2 font-semibold"><CheckCircle2 className="size-3.5" aria-hidden />人工评估待评估列表</div>
          <p className="mt-1">复核 Bad Case 与低分服务，写出期望回复并沉淀为标注数据。失败 Run、Eval 单条/批次执行失败、Run 标注人工跟进和低评分服务数据会自动进入这里。</p>
        </div>
        <div className="ops-kpi-grid">
          <Kpi label="待评估" value={String(evaluations.length)} hint="evaluating" tone={evaluations.length > 0 ? 'warning' : 'success'} />
          <Kpi label="Bad Case" value={String(badCases)} hint="失败 Run" tone="danger" />
          <Kpi label="低评分" value={String(lowRatings)} hint="评分 ≤ 2" tone="warning" />
          <Kpi label="低分标注" value={String(lowAnnotations)} hint="overall ≤ 2 / rejected" tone="warning" />
          <Kpi label="Run 跟进" value={String(followups)} hint="Run 标注人工跟进" tone="accent" />
          <Kpi label="已沉淀" value={String(annotations.filter((annotation) => annotation.origin.endsWith('-evaluation')).length)} hint="保存为数据标注" tone="success" />
        </div>
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div><CardTitle className="flex items-center gap-2"><CheckCircle2 className="size-4 text-primary" aria-hidden />待评估数据</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">展开每条数据，填写期望回复、意图、质量标签、必经 Skill、期望 Tool 事实、禁用表述和六维备注，再保存为标注。</p></div>
            <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setTab('annotations')}><ClipboardCheck aria-hidden /> 查看数据标注</Button><Button asChild size="sm" variant="outline"><Link href="/evals"><FlaskConical aria-hidden /> 评测中心</Link></Button></div>
          </CardHeader>
          <CardContent className="space-y-2">
            {evaluations.length === 0 ? <EmptyState title="暂无待评估数据" description="失败 Run、低评分服务或 Run 标注人工跟进入队后会出现在这里。" /> : evaluations.map((annotation) => (
              <AnnotationQueueCard
                key={`${annotation.id}-${annotation.updatedAt ?? annotation.createdAt}`}
                annotation={annotation}
                mode="evaluation"
                onSave={(patch) => saveAnnotationFields(annotation.id, patch)}
                onSaveAsAnnotation={() => saveEvaluationAsAnnotation(annotation)}
              />
            ))}
          </CardContent>
        </Card>

      </div>
    );
  }

  function renderRollback() {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><RotateCcw className="size-4 text-primary" aria-hidden />版本回滚</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">读取 Skill 历史版本，恢复旧正文并创建新的当前版本与快照；回滚本身也可追溯。</p></CardHeader>
          <CardContent className="space-y-3">
            {errors.skills ? <SectionError message={errors.skills} /> : null}
            <div className="grid gap-2 md:grid-cols-2">
              <label className="text-[10px] text-muted-foreground">选择 Skill<select className="field-select mt-1" value={rollbackSkillId} onChange={(event) => void chooseRollbackSkill(event.target.value)}><option value="">选择 Skill</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name} · {skill.version}</option>)}</select></label>
              <label className="text-[10px] text-muted-foreground">选择要恢复的版本<select className="field-select mt-1" value={rollbackVersionId} onChange={(event) => setRollbackVersionId(event.target.value)} disabled={rollbackVersions.length === 0}><option value="">选择版本</option>{rollbackVersions.map((version) => <option key={version.id} value={version.id} disabled={version.status === '当前' || version.status === '草稿'}>v{version.version} · {version.status} · {version.changeNote}</option>)}</select></label>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => void rollbackVersion()} disabled={!rollbackSkillId || !rollbackVersionId || rollbackPending}>{rollbackPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}{rollbackPending ? '回滚中…' : '回滚并创建新版本'}</Button>
            {rollbackVersions.length > 0 ? <div className="space-y-1">{rollbackVersions.map((version) => <div key={version.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[10px]"><span className="font-mono">{version.id}</span><span>v{version.version}</span><Badge tone={version.status === '当前' ? 'success' : 'neutral'}>{version.status}</Badge><span className="text-muted-foreground">{version.changeNote}</span></div>)}</div> : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderAbTests() {
    const skillName = (id: string | undefined) => skills.find((skill) => skill.id === id)?.name ?? id ?? '未绑定 Skill';
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><GitBranch className="size-4 text-primary" aria-hidden />Prompt A/B</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">一次实验只验证一个 Skill 的 Prompt：选择一个 Skill，编辑 A/B 两版 Prompt，设置流量和开关。</p></CardHeader>
          <CardContent className="space-y-3">
            {errors.abTests ? <SectionError message={errors.abTests} /> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Input className="max-w-[360px]" value={abForm.name} onChange={(event) => setAbForm((current) => ({ ...current, name: event.target.value }))} placeholder="实验名称" />
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground"><input type="checkbox" checked={abForm.enabledA} onChange={(event) => setAbForm((current) => ({ ...current, enabledA: event.target.checked }))} />开启 A</label>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground"><input type="checkbox" checked={abForm.enabledB} onChange={(event) => setAbForm((current) => ({ ...current, enabledB: event.target.checked }))} />开启 B</label>
            </div>
            <label className="block text-[10px] text-muted-foreground">实验 Skill（只选一次）
              <select className="field-select mt-1" value={abForm.skillId} onChange={(event) => void loadAbSkillPrompt(event.target.value, 'create')} disabled={abSkillLoading}>
                <option value="">选择要进行 Prompt A/B 的 Skill</option>
                {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name} · {skill.id} · v{skill.version}</option>)}
              </select>
            </label>
            {abSkillLoading ? <p className="text-[10px] text-muted-foreground">正在读取 Skill 当前 Prompt…</p> : null}
            <div className="grid gap-3 xl:grid-cols-2">
              <label className="text-[10px] text-muted-foreground">A 版本 Prompt<Textarea className="mt-1 font-mono text-[10px]" rows={6} value={abForm.promptA} onChange={(event) => setAbForm((current) => ({ ...current, promptA: event.target.value }))} placeholder="选择 Skill 后自动填入当前 Prompt，可编辑 A 版本" /></label>
              <label className="text-[10px] text-muted-foreground">B 版本 Prompt<Textarea className="mt-1 font-mono text-[10px]" rows={6} value={abForm.promptB} onChange={(event) => setAbForm((current) => ({ ...current, promptB: event.target.value }))} placeholder="编辑 B 版本 Prompt" /></label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[10px] text-muted-foreground">A 流量 %<Input className="mt-1" inputMode="numeric" value={abForm.trafficA} onChange={(event) => setAbForm((current) => ({ ...current, trafficA: event.target.value }))} /></label>
              <label className="text-[10px] text-muted-foreground">B 流量 %<Input className="mt-1" inputMode="numeric" value={abForm.trafficB} onChange={(event) => setAbForm((current) => ({ ...current, trafficB: event.target.value }))} /></label>
            </div>
            <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => void createAbTest()} disabled={abSaving || !abForm.name || !abForm.skillId || !abForm.promptA || !abForm.promptB}>{abSaving ? <LoaderCircle className="animate-spin" aria-hidden /> : <span aria-hidden>+</span>}新增实验并保存</Button><span className="text-[10px] text-muted-foreground">建议 A/B 流量合计 100%；关闭 A 或 B 后仍保留配置。</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="size-4 text-primary" aria-hidden />已有实验</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">{abTests.length} 条 A/B 记录 · 保留原有记录</p></CardHeader>
          <CardContent className="space-y-2">
            {abTests.length === 0 ? <EmptyState title="暂无 A/B 实验" description="选择一个 Skill 后创建第一条 Prompt A/B 草稿。" /> : abTests.map((test) => {
              const promptA = test.promptA ?? test.variantA;
              const promptB = test.promptB ?? test.variantB;
              return (
                <div key={test.id} className="rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone={test.status === '确认应用' ? 'success' : test.status === '运行中' ? 'success' : test.status === '已结束' ? 'neutral' : 'warning'}>{test.status}</Badge><span className="text-xs font-semibold">{test.name}</span><Badge tone="neutral">{skillName(test.skillId ?? test.skillAId ?? test.skillBId)}</Badge><Badge tone={test.enabledA ? 'success' : 'neutral'}>A {test.enabledA ? '开' : '关'} · {test.trafficA}%</Badge><Badge tone={test.enabledB ? 'success' : 'neutral'}>B {test.enabledB ? '开' : '关'} · {test.trafficB}%</Badge></div>
                    <div className="flex flex-wrap gap-1.5">
                      {test.status === '草稿' ? <Button type="button" size="sm" onClick={() => void confirmAbDraft(test.id)} disabled={abConfirming === test.id}>{abConfirming === test.id ? <LoaderCircle className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}{abConfirming === test.id ? '应用中…' : '确认应用'}</Button> : null}
                      <Button type="button" size="sm" variant="outline" onClick={() => openAbEdit(test)}>编辑 / 保存实验</Button>
                    </div>
                  </div>
                  <div className="mt-1 grid gap-1 text-[10px] leading-5 text-muted-foreground xl:grid-cols-2">
                    <p className="line-clamp-2"><span className="font-semibold text-foreground/80">A：</span>{promptA}</p>
                    <p className="line-clamp-2"><span className="font-semibold text-foreground/80">B：</span>{promptB}</p>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{test.metric} · n={test.sampleSize}{test.baseVersion ? ` · A 原版本 v${test.baseVersion}` : ''}{test.draftVersion ? ` · B 新版本 v${test.draftVersion}` : ''}{test.appliedVersion ? ` · 已应用 v${test.appliedVersion}` : ''}{test.winner ? ` · Winner：${test.winner}` : ''}</p>
                  {test.status === '草稿' ? <p className="mt-1 text-[10px] text-amber-800">草稿尚未生效；点击“确认应用”后才会把 B Prompt 写入当前 Skill。</p> : null}
                  {test.status === '确认应用' ? <p className="mt-1 text-[10px] text-emerald-800">已确认应用，B Prompt 已写入当前 Skill。</p> : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
        <Dialog open={editingAb !== null} onOpenChange={(open) => { if (!open) setEditingAb(null); }} title="保存 Prompt A/B 实验" description="同一个 Skill 的 A/B Prompt、流量与开关；保存后写回 ab-tests.json。" className="max-w-3xl">
          {editingAb ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={editingAb.name} onChange={(event) => setEditingAb({ ...editingAb, name: event.target.value })} placeholder="实验名称" />
                <label className="text-[10px] text-muted-foreground">状态<select className="field-select mt-1" value={editingAb.status} onChange={(event) => setEditingAb({ ...editingAb, status: event.target.value as AbTest['status'] })}><option value="草稿">草稿</option><option value="运行中">运行中</option><option value="已结束">已结束</option><option value="确认应用">确认应用</option></select></label>
              </div>
              <label className="block text-[10px] text-muted-foreground">实验 Skill<select className="field-select mt-1" value={editingAb.skillId ?? editingAb.skillAId ?? ''} onChange={(event) => void loadAbSkillPrompt(event.target.value, 'edit')} disabled={abSkillLoading}><option value="">选择 Skill</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name} · {skill.id}</option>)}</select></label>
              <div className="grid gap-3 xl:grid-cols-2">
                <label className="text-[10px] text-muted-foreground">A 版本 Prompt<Textarea className="mt-1 font-mono text-[10px]" rows={6} value={editingAb.promptA ?? editingAb.variantA} onChange={(event) => setEditingAb({ ...editingAb, promptA: event.target.value })} /></label>
                <label className="text-[10px] text-muted-foreground">B 版本 Prompt<Textarea className="mt-1 font-mono text-[10px]" rows={6} value={editingAb.promptB ?? editingAb.variantB} onChange={(event) => setEditingAb({ ...editingAb, promptB: event.target.value })} /></label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[10px] text-muted-foreground">A 流量 %<Input className="mt-1" inputMode="numeric" value={editingAb.trafficA} onChange={(event) => setEditingAb({ ...editingAb, trafficA: Number(event.target.value) || 0 })} /></label>
                <label className="text-[10px] text-muted-foreground">B 流量 %<Input className="mt-1" inputMode="numeric" value={editingAb.trafficB} onChange={(event) => setEditingAb({ ...editingAb, trafficB: Number(event.target.value) || 0 })} /></label>
              </div>
              <div className="flex gap-4 text-[11px]"><label className="flex items-center gap-1"><input type="checkbox" checked={editingAb.enabledA} onChange={(event) => setEditingAb({ ...editingAb, enabledA: event.target.checked })} />开启 A</label><label className="flex items-center gap-1"><input type="checkbox" checked={editingAb.enabledB} onChange={(event) => setEditingAb({ ...editingAb, enabledB: event.target.checked })} />开启 B</label></div>
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditingAb(null)}>取消</Button><Button type="button" onClick={() => void saveAbTestEdit()} disabled={abEditSaving || !editingAb.name || !editingAb.skillId || !editingAb.promptA || !editingAb.promptB}>{abEditSaving ? <LoaderCircle className="animate-spin" aria-hidden /> : <GitBranch aria-hidden />}{abEditSaving ? '保存中…' : '保存实验'}</Button></div>
            </div>
          ) : null}
        </Dialog>
      </div>
    );
  }


  function renderCurrentTab() {

    if (loading) return <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-8 text-xs text-muted-foreground"><LoaderCircle className="animate-spin" aria-hidden /> 正在读取运营数据…</div>;
    if (tab === 'monitor') return renderMonitor();
    if (tab === 'ratings') return renderRatings();
    if (tab === 'annotations') return renderAnnotations();
    if (tab === 'improvements') return renderImprovements();
    if (tab === 'manual-eval') return renderManualEvaluation();
    if (tab === 'rollback') return renderRollback();
    return renderAbTests();
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="page-kicker">OPS / FEEDBACK LOOP</p>
          <h1 className="page-title">运营中心</h1>
          <p className="page-description">从 Run 发现问题，完成评分、标注、规则聚类、Prompt 草案、版本应用与回滚；每个动作都写回服务端 JSON。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void refreshAll()} disabled={refreshing}>{refreshing ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}{refreshing ? '刷新中…' : '刷新数据'}</Button>
          <Button asChild variant="outline"><Link href="/">打开 Agent 工作台 <ArrowRight aria-hidden /></Link></Button>
        </div>
      </header>
      <nav className="ops-tabs" aria-label="运营中心分区">
        {TABS.map((item) => {
          const Icon = item.icon;
          const count =
            item.key === 'ratings'
              ? ratings.length
              : item.key === 'annotations'
                ? annotations.filter((annotation) => annotation.status === 'pending').length
                : item.key === 'improvements'
                  ? improvements?.clusters.length
                  : item.key === 'manual-eval'
                    ? annotations.filter((annotation) => annotation.status === 'evaluating').length
                    : item.key === 'ab-tests'
                      ? abTests.length
                      : undefined;
          return <button key={item.key} type="button" className={`ops-tab ${tab === item.key ? 'ops-tab-active' : ''}`} onClick={() => setTab(item.key)}><Icon className="size-3.5" aria-hidden />{item.label}{count !== undefined ? <span className="ops-tab-count">{count}</span> : null}</button>;
        })}
      </nav>
      {renderCurrentTab()}
    </div>
  );
}
