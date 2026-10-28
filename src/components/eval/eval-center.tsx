'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  FlaskConical,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { AgentStreamError, streamAgentRun } from '@/lib/agent-stream';
import { formatDateTime } from '@/lib/client';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DetailedEvalScore } from '@/lib/eval/detailed-score';
import type {
  EvalBatch,
  EvalBatchCaseResult,
  EvalCase,
  DetailedEvalScoreResponse,
  EvalConfig,
  EvalResponse,
  Run,
  RunDetailResponse,
} from '@/lib/types';

type Difficulty = EvalCase['difficulty'];
type RiskLevel = EvalCase['riskLevel'];
type Dimension = EvalCase['evalDimension'];

type ComparisonResult = {
  comparable: boolean;
  reasons: string[];
  a: EvalBatch;
  b: EvalBatch;
  rows: { caseId: string; name: string; aStatus: string; bStatus: string; kind: 'fixed' | 'new-failure' | 'reply-changed' | 'status-changed' | 'same' }[];
  averageDurationA: number;
  averageDurationB: number;
  passedDelta: number;
  failedDelta: number;
  reviewDelta: number;
  errorDelta: number;
};

type CaseForm = {
  name: string;
  question: string;
  scenario: string;
  difficulty: Difficulty;
  riskLevel: RiskLevel;
  expectedReply: string;
  expectedKeywords: string;
  expectedToolFacts: string;
  maxLatencyMs: string;
  keywordMode: 'AND' | 'OR';
  forbiddenWords: string;
  expectedPrice: string;
  expectRiskPassed: boolean;
  requiredCapabilities: string;
  forbiddenCapabilities: string;
  evalDimension: Dimension;
  llmJudgePrompt: string;
  tags: string;
  enabled: boolean;
};

const EMPTY_FORM: CaseForm = {
  name: '',
  question: '',
  scenario: '通用',
  difficulty: 'medium',
  riskLevel: 'low',
  expectedReply: '',
  expectedKeywords: '',
  expectedToolFacts: '',
  maxLatencyMs: '3000',
  keywordMode: 'AND',
  forbiddenWords: '',
  expectedPrice: '',
  expectRiskPassed: true,
  requiredCapabilities: '',
  forbiddenCapabilities: '',
  evalDimension: 'overall',
  llmJudgePrompt: '',
  tags: '',
  enabled: true,
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '简单', medium: '中等', hard: '困难' };
const RISK_LABEL: Record<RiskLevel, string> = { none: 'none', low: 'low', medium: 'medium', high: 'high' };
const DIMENSION_LABEL: Record<Dimension, string> = {
  correctness: '正确性',
  relevance: '相关性',
  completeness: '完整性',
  safety: '安全性',
  tone: '语气',
  overall: '综合',
};

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init });
  const payload = (await response.json().catch(() => null)) as { error?: string } | T | null;
  if (!response.ok) {
    throw new Error((payload as { error?: string } | null)?.error ?? `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

function split(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : '请求失败';
}

function statusTone(status: string): BadgeTone {
  if (status === 'PASS') return 'success';
  if (status === 'FAIL') return 'danger';
  if (status === 'REVIEW') return 'warning';
  if (status === 'ERROR') return 'neutral';
  return 'neutral';
}

function formFromCase(evalCase: EvalCase): CaseForm {
  return {
    name: evalCase.name,
    question: evalCase.question,
    scenario: evalCase.scenario,
    difficulty: evalCase.difficulty,
    riskLevel: evalCase.riskLevel,
    expectedReply: evalCase.expectedReply,
    expectedKeywords: evalCase.expectedKeywords.join(', '),
    expectedToolFacts: evalCase.expectedToolFacts.join(', '),
    maxLatencyMs: String(evalCase.maxLatencyMs),
    keywordMode: evalCase.keywordMode,
    forbiddenWords: evalCase.forbiddenWords.join(', '),
    expectedPrice: evalCase.expectedPrice === null ? '' : String(evalCase.expectedPrice),
    expectRiskPassed: evalCase.expectRiskPassed,
    requiredCapabilities: evalCase.requiredCapabilities.join(', '),
    forbiddenCapabilities: evalCase.forbiddenCapabilities.join(', '),
    evalDimension: evalCase.evalDimension,
    llmJudgePrompt: evalCase.llmJudgePrompt,
    tags: evalCase.tags.join(', '),
    enabled: evalCase.enabled,
  };
}

function bodyFromForm(form: CaseForm) {
  return {
    name: form.name,
    question: form.question,
    scenario: form.scenario,
    difficulty: form.difficulty,
    riskLevel: form.riskLevel,
    expectedReply: form.expectedReply,
    expectedKeywords: split(form.expectedKeywords),
    expectedToolFacts: split(form.expectedToolFacts),
    maxLatencyMs: Number(form.maxLatencyMs) || 3000,
    keywordMode: form.keywordMode,
    forbiddenWords: split(form.forbiddenWords),
    expectedPrice: form.expectedPrice.trim() === '' ? null : Number(form.expectedPrice),
    expectRiskPassed: form.expectRiskPassed,
    requiredCapabilities: split(form.requiredCapabilities),
    forbiddenCapabilities: split(form.forbiddenCapabilities),
    evalDimension: form.evalDimension,
    llmJudgePrompt: form.llmJudgePrompt,
    tags: split(form.tags),
    enabled: form.enabled,
  };
}

const TERMINAL_BATCH_STATUSES = new Set(['done', 'error', 'cancelled', '已完成', '运行中', '排队中']);
function isTerminalBatch(status: string): boolean {
  return TERMINAL_BATCH_STATUSES.has(status);
}
function batchStatusTone(status: string): BadgeTone {
  if (status === 'done' || status === '已完成') return 'success';
  if (status === 'error' || status === 'cancelled') return 'danger';
  if (status === 'running' || status === '运行中') return 'warning';
  return 'neutral';
}
function batchStatusLabel(status: string): string {
  if (status === 'queued') return '排队中';
  if (status === 'running') return '运行中';
  if (status === 'done' || status === '已完成') return '已完成';
  if (status === 'error') return '错误';
  if (status === 'cancelled') return '已取消';
  if (status === '运行中') return '运行中';
  return status;
}
function scoreOf(result: EvalBatchCaseResult): DetailedEvalScore | null {
  return result.score as DetailedEvalScore | null;
}
function resultsOf(batch: EvalBatch): EvalBatchCaseResult[] {
  return batch.caseResults as EvalBatchCaseResult[];
}

const SCORE_DIMENSION_KEYS = ['planner', 'skill', 'tool', 'reply', 'risk', 'performance'] as const;
const SCORE_DIMENSION_LABELS: Record<(typeof SCORE_DIMENSION_KEYS)[number], string> = {
  planner: 'Planner',
  skill: 'Skill',
  tool: 'Tool',
  reply: '回复',
  risk: '风控',
  performance: '性能',
};
function DimensionScores({ score }: { score: DetailedEvalScore | null }) {
  if (!score) return <span className="text-[10px] text-muted-foreground">未运行</span>;
  if (!score.dimensions) return <span className="text-[10px] text-muted-foreground">历史结果无六维评分</span>;
  return (
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
      {SCORE_DIMENSION_KEYS.map((key) => (
        <div key={key} className="rounded-md border bg-muted/20 px-1.5 py-1 text-[9px]">
          <p className="text-muted-foreground">{SCORE_DIMENSION_LABELS[key]}</p>
          <p className="font-semibold">{score.dimensions[key]?.score ?? '—'} <span className="font-normal text-muted-foreground">/ {Math.round((score.weights[key] ?? 0) * 100)}%</span></p>
        </div>
      ))}
    </div>
  );
}

function CalculationLine({ score }: { score: DetailedEvalScore | null }) {
  if (!score || !score.calculation) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground">
      {score.calculation.map((line) => <span key={line}>{line}</span>)}
    </div>
  );
}

function DimensionReasons({ score }: { score: DetailedEvalScore | null }) {
  if (!score?.dimensions) return null;
  const incomplete = SCORE_DIMENSION_KEYS
    .map((key) => ({ key, detail: score.dimensions[key] }))
    .filter((item) => item.detail && item.detail.score < 100);
  if (incomplete.length === 0) return <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[10px] text-emerald-900">六维均为满分。</p>;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-[10px] text-amber-950">
      <p className="font-semibold">未满分维度原因</p>
      <div className="mt-1 space-y-1.5">
        {incomplete.map(({ key, detail }) => (
          <div key={key}>
            <p className="font-medium">{SCORE_DIMENSION_LABELS[key]} · {detail.score} 分</p>
            <ul className="mt-0.5 list-inside list-disc leading-5 text-amber-900/85">
              {(detail.details.length > 0 ? detail.details : [detail.basis]).map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineCaseProcess({
  result,
  evalCase,
  run,
  loading,
}: {
  result: EvalBatchCaseResult;
  evalCase: EvalCase;
  run: Run | null;
  loading: boolean;
}) {
  const score = scoreOf(result);
  return (
    <div className="mt-2 space-y-2 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px]"><Badge tone={statusTone(result.status)}>{result.status}</Badge><span className="text-muted-foreground">直接在评测集内展开，未创建批次 · 耗时 {result.durationMs}ms</span>{result.runId ? <Link href={`/runs/${result.runId}`} className="ml-auto text-primary hover:underline">Trace</Link> : null}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md bg-muted/40 px-2.5 py-2"><p className="text-[9px] font-medium text-muted-foreground">评测输入</p><p className="mt-1 whitespace-pre-wrap text-[10px] leading-5">{evalCase.question}</p></div>
        <div className="rounded-md bg-muted/40 px-2.5 py-2"><p className="text-[9px] font-medium text-muted-foreground">最终回复</p><p className="mt-1 whitespace-pre-wrap text-[10px] leading-5">{result.finalReply ?? '（无最终回复）'}</p></div>
      </div>
      {score ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border px-2 py-1.5 text-[10px]"><p className="font-semibold">精准匹配 · {score.precision?.score ?? '—'}</p><p className="mt-1 text-muted-foreground">命中 {score.precision?.keywordHits?.join(' / ') || '—'}</p><p className="text-muted-foreground">缺失 {score.precision?.keywordMisses?.join(' / ') || '—'}</p><p className="text-muted-foreground">禁用表述 {score.precision?.forbiddenHits?.join(' / ') || '—'}</p></div>
          <div className="rounded-md border px-2 py-1.5 text-[10px]"><p className="font-semibold">余弦相似度 · {score.cosine?.score ?? '—'}</p><p className="mt-1 text-muted-foreground">{score.cosine?.method ?? '未计算'}</p><p className="text-muted-foreground">{score.cosine?.detail ?? '未计算'}</p></div>
          <div className="rounded-md border px-2 py-1.5 text-[10px]"><p className="font-semibold">LLM-as-Judge · {score.judge?.score ?? '—'}</p><p className="mt-1 text-muted-foreground">启用：{score.judge?.enabled ? '是' : '否'} · {score.judge?.provider ?? '—'}</p><p className="text-muted-foreground">{score.judge?.error ?? score.judge?.reason ?? '未执行'}</p></div>
          <div className="rounded-md border px-2 py-1.5 text-[10px]"><p className="font-semibold">人工评估 · {score.human?.score ?? '—'}</p><p className="mt-1 text-muted-foreground">启用：{score.human?.enabled ? '是' : '否'} · 权重 {Math.round((score.human?.weight ?? 0) * 100)}%</p><p className="text-muted-foreground">{score.human?.details?.join('；') || '无六维人工标注'}</p></div>
        </div>
      ) : null}
      <DimensionReasons score={score} />
      {score?.issues?.length ? <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900"><span className="font-semibold">发现的问题：</span>{score.issues.join('；')}</div> : null}
      <div className="rounded-md bg-muted/40 px-2.5 py-2 text-[10px] leading-5"><span className="font-semibold">Planner 摘要：</span>{score?.plannerSummary ?? '无'}</div>
      <div className="rounded-md border px-2.5 py-2">
        <p className="text-[10px] font-semibold">执行步骤（{run?.steps.length ?? score?.stepCount ?? 0}）</p>
        {loading ? <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><LoaderCircle className="size-3 animate-spin" aria-hidden />读取 Trace…</p> : null}
        <div className="mt-1 space-y-1">{(run?.steps ?? []).map((step) => <details key={step.id} className="rounded-md border bg-card px-2 py-1.5 text-[10px]"><summary className="cursor-pointer"><Badge tone={step.status === 'ERROR' ? 'danger' : 'success'}>{step.status}</Badge> <span className="ml-1 font-mono">{step.type} · {step.capabilityId}</span><span className="ml-2 text-muted-foreground">{step.durationMs}ms</span></summary><div className="mt-1 grid gap-1 sm:grid-cols-2"><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-1.5">{JSON.stringify(step.input, null, 2)}</pre><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-1.5">{JSON.stringify(step.output, null, 2)}</pre></div></details>)}</div>
      </div>
    </div>
  );
}

function CaseFields({ form, setForm }: { form: CaseForm; setForm: (next: CaseForm) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[10px] text-muted-foreground">名称<Input className="mt-1" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="text-[10px] text-muted-foreground">场景 / 分类<Input className="mt-1" value={form.scenario} onChange={(event) => setForm({ ...form, scenario: event.target.value })} /></label>
      </div>
      <label className="block text-[10px] text-muted-foreground">用户问题<Textarea className="mt-1" rows={2} value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} /></label>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[10px] text-muted-foreground">难度<select className="field-select mt-1" value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value as Difficulty })}><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option></select></label>
        <label className="text-[10px] text-muted-foreground">风险等级<select className="field-select mt-1" value={form.riskLevel} onChange={(event) => setForm({ ...form, riskLevel: event.target.value as RiskLevel })}><option value="none">none</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
        <label className="text-[10px] text-muted-foreground">评测维度<select className="field-select mt-1" value={form.evalDimension} onChange={(event) => setForm({ ...form, evalDimension: event.target.value as Dimension })}>{Object.entries(DIMENSION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <label className="block text-[10px] text-muted-foreground">期望回复（Judge 启用且可用时参与回复分；不可用时明确标注）<Textarea className="mt-1" rows={2} value={form.expectedReply} onChange={(event) => setForm({ ...form, expectedReply: event.target.value })} /></label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[10px] text-muted-foreground">期望关键词（逗号分隔）<Input className="mt-1" value={form.expectedKeywords} onChange={(event) => setForm({ ...form, expectedKeywords: event.target.value })} /></label>
        <label className="text-[10px] text-muted-foreground">关键词模式<select className="field-select mt-1" value={form.keywordMode} onChange={(event) => setForm({ ...form, keywordMode: event.target.value as 'AND' | 'OR' })}><option value="AND">AND · 全部命中</option><option value="OR">OR · 任一命中</option></select></label>
        <label className="text-[10px] text-muted-foreground">禁词（逗号分隔）<Input className="mt-1" value={form.forbiddenWords} onChange={(event) => setForm({ ...form, forbiddenWords: event.target.value })} /></label>
        <label className="text-[10px] text-muted-foreground">期望价格（元，可空）<Input className="mt-1" inputMode="decimal" value={form.expectedPrice} onChange={(event) => setForm({ ...form, expectedPrice: event.target.value })} /></label>
        <label className="text-[10px] text-muted-foreground">最大延迟 ms（性能维度上限）<Input className="mt-1" inputMode="numeric" value={form.maxLatencyMs} onChange={(event) => setForm({ ...form, maxLatencyMs: event.target.value })} /></label>
        <label className="text-[10px] text-muted-foreground">期望 Tool 事实（逗号分隔）<Input className="mt-1" value={form.expectedToolFacts} onChange={(event) => setForm({ ...form, expectedToolFacts: event.target.value })} /></label>
        <label className="text-[10px] text-muted-foreground">必经能力（逗号分隔，如 tool:query_orders）<Input className="mt-1" value={form.requiredCapabilities} onChange={(event) => setForm({ ...form, requiredCapabilities: event.target.value })} /></label>
        <label className="text-[10px] text-muted-foreground">禁用能力（逗号分隔）<Input className="mt-1" value={form.forbiddenCapabilities} onChange={(event) => setForm({ ...form, forbiddenCapabilities: event.target.value })} /></label>
      </div>
      <label className="block text-[10px] text-muted-foreground">用例 Judge 标准（会追加到统一 Judge Prompt；留空使用统一配置）<Textarea className="mt-1" rows={2} value={form.llmJudgePrompt} onChange={(event) => setForm({ ...form, llmJudgePrompt: event.target.value })} placeholder="例如：必须回答退货时限，且不得承诺额外赔偿" /></label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[10px] text-muted-foreground">标签（逗号分隔）<Input className="mt-1" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></label>
        <label className="flex items-end gap-2 pb-1 text-[11px]"><input type="checkbox" checked={form.expectRiskPassed} onChange={(event) => setForm({ ...form, expectRiskPassed: event.target.checked })} />期望 risk-check 放行</label>
        <label className="flex items-center gap-2 pb-1 text-[11px]"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />启用用例</label>
      </div>
    </div>
  );
}

export function EvalCenter() {
  const [data, setData] = useState<EvalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ enabled: 'enabled', scenario: '', difficulty: '', riskLevel: '', dimension: '' });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EvalCase | null>(null);
  const [form, setForm] = useState<CaseForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [fromRunOpen, setFromRunOpen] = useState(false);
  const [fromRunId, setFromRunId] = useState('');
  const [fromRunName, setFromRunName] = useState('');
  const [fromRunSaving, setFromRunSaving] = useState(false);
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);
  const [caseRuns, setCaseRuns] = useState<Record<string, { result: EvalBatchCaseResult; run: Run }>>({});
  const [caseRunErrors, setCaseRunErrors] = useState<Record<string, string>>({});
  const [caseProcessOpen, setCaseProcessOpen] = useState<Record<string, boolean>>({});
  const [rerunResults, setRerunResults] = useState<Record<string, { result: EvalBatchCaseResult; run: Run }>>({});
  const [rerunLoading, setRerunLoading] = useState<string | null>(null);
  const [rerunErrors, setRerunErrors] = useState<Record<string, string>>({});
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchCreating, setBatchCreating] = useState(false);
  const [batchForm, setBatchForm] = useState({ name: '', versionLabel: '', changeNote: '', caseIds: [] as string[] });
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [activeBatch, setActiveBatch] = useState<EvalBatch | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const batchCreatingRef = useRef(false);
  const [activeTab, setActiveTab] = useState<'cases' | 'process' | 'compare'>('cases');
  const [judgeConfig, setJudgeConfig] = useState<EvalConfig | null>(null);
  const [judgeDraft, setJudgeDraft] = useState('');
  const [judgeSaving, setJudgeSaving] = useState(false);
  const [badCaseOnly, setBadCaseOnly] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Record<string, boolean>>({});
  const [runCache, setRunCache] = useState<Record<string, Run>>({});
  const [runLoading, setRunLoading] = useState<string | null>(null);

  async function load() {
    try {
      const result = await fetchJson<EvalResponse>('/api/eval');
      setData(result);
      setJudgeConfig(result.config);
      setJudgeDraft(result.config.judgeSystemPrompt);
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function initialLoad() {
      try {
        const result = await fetchJson<EvalResponse>('/api/eval');
        if (!active) return;
        setData(result);
        setJudgeConfig(result.config);
        setJudgeDraft(result.config.judgeSystemPrompt);
        setError(null);
        const latest = result.batches.find((batch) => (batch.caseResults as EvalBatchCaseResult[]).length > 0);
        if (latest) setActiveBatchId((current) => current ?? latest.id);
      } catch (caught) {
        if (active) setError(errorText(caught));
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialLoad();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!activeBatchId) return;
    const batchId = activeBatchId;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll() {
      try {
        const result = await fetchJson<{ batch: EvalBatch }>(
          `/api/eval/batch/${encodeURIComponent(batchId)}`,
        );
        if (!active) return;
        setActiveBatch(result.batch);
        setBatchError(null);
        if (isTerminalBatch(result.batch.status)) {
          await load();
          return;
        }
        timer = setTimeout(() => void poll(), 1000);
      } catch (caught) {
        if (!active) return;
        setBatchError(errorText(caught));
      }
    }
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [activeBatchId]);

  const cases = data?.cases ?? [];
  const scenarios = [...new Set(cases.map((item) => item.scenario))];
  const filtered = cases.filter((item) => {
    if (filters.enabled === 'enabled' && !item.enabled) return false;
    if (filters.enabled === 'disabled' && item.enabled) return false;
    if (filters.scenario && item.scenario !== filters.scenario) return false;
    if (filters.difficulty && item.difficulty !== filters.difficulty) return false;
    if (filters.riskLevel && item.riskLevel !== filters.riskLevel) return false;
    if (filters.dimension && item.evalDimension !== filters.dimension) return false;
    return true;
  });

  function openBatchModal() {
    const previous = (data?.batches ?? []).find((batch) => batch.caseIds.length > 0);
    const defaultIds = previous
      ? previous.caseIds.filter((id) => cases.some((item) => item.id === id))
      : cases.filter((item) => item.enabled).map((item) => item.id);
    setBatchForm({ name: '', versionLabel: '', changeNote: '', caseIds: defaultIds });
    setBatchOpen(true);
  }

  async function startBatch() {
    if (batchCreatingRef.current) return;
    batchCreatingRef.current = true;
    if (batchForm.caseIds.length === 0) {
      batchCreatingRef.current = false;
      toast.error('至少选择一个评测用例');
      return;
    }
    setBatchCreating(true);
    try {
      const result = await fetchJson<{ batchId: string; batch: EvalBatch }>('/api/eval/batch/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseIds: batchForm.caseIds,
          name: batchForm.name.trim() || undefined,
          versionLabel: batchForm.versionLabel.trim() || undefined,
          changeNote: batchForm.changeNote.trim() || undefined,
        }),
      });
      setBatchOpen(false);
      setActiveBatch(result.batch);
      setActiveBatchId(result.batchId);
      setBatchError(null);
      setActiveTab('process');
      toast.success('评测批次已创建', { description: `${result.batch.total} 条用例已进入执行队列` });
      await load();
    } catch (caught) {
      toast.error('创建评测批次失败', { description: errorText(caught) });
    } finally {
      batchCreatingRef.current = false;
      setBatchCreating(false);
    }
  }

  async function deleteBatchItem(batch: EvalBatch) {
    if (!window.confirm(`确认删除批次「${batch.name}」？批次里的 RunRecord 会保留，但批次记录与对比结果会消失。`)) return;
    try {
      await fetchJson(`/api/eval/batch/${encodeURIComponent(batch.id)}`, { method: 'DELETE' });
      toast.success('批次已删除', { description: batch.name });
      if (activeBatchId === batch.id) {
        setActiveBatchId(null);
        setActiveBatch(null);
      }
      if (compareA === batch.id) setCompareA('');
      if (compareB === batch.id) setCompareB('');
      setComparison(null);
      await load();
    } catch (caught) {
      toast.error('删除批次失败', { description: errorText(caught) });
    }
  }

  function compareBatches() {
    const a = (data?.batches ?? []).find((batch) => batch.id === compareA);
    const b = (data?.batches ?? []).find((batch) => batch.id === compareB);
    if (!a || !b) {
      toast.error('请选择两个批次');
      return;
    }
    const reasons: string[] = [];
    if (!a.caseSetHash || !b.caseSetHash || a.caseSetHash !== b.caseSetHash) {
      reasons.push('caseIds 或用例快照不一致');
    }
    if (JSON.stringify([...a.caseIds].sort()) !== JSON.stringify([...b.caseIds].sort())) {
      reasons.push('caseIds 集合不一致');
    }
    if (!a.evaluatorHash || !b.evaluatorHash || a.evaluatorHash !== b.evaluatorHash) {
      reasons.push('评分器版本/hash 不一致');
    }
    if (a.provider !== b.provider || a.model !== b.model || JSON.stringify(a.params) !== JSON.stringify(b.params)) {
      reasons.push('Provider、模型或运行参数不一致');
    }
    if (!['done', '已完成'].includes(a.status) || !['done', '已完成'].includes(b.status)) {
      reasons.push('至少一个批次未成功完成，不能直接比较');
    }
    if (resultsOf(a).length === 0 || resultsOf(b).length === 0) {
      reasons.push('至少一个批次没有完整 caseResults');
    }
    if (resultsOf(a).length !== a.caseIds.length || resultsOf(b).length !== b.caseIds.length) {
      reasons.push('至少一个批次的 caseResults 与 caseIds 数量不一致');
    }
    const aResults = new Map(resultsOf(a).map((result) => [result.caseId, result]));
    const bResults = new Map(resultsOf(b).map((result) => [result.caseId, result]));
    const rows = [...aResults.keys()].filter((id) => bResults.has(id)).map((caseId) => {
      const aResult = aResults.get(caseId)!;
      const bResult = bResults.get(caseId)!;
      let kind: ComparisonResult['rows'][number]['kind'] = 'same';
      if (aResult.status !== 'PASS' && bResult.status === 'PASS') kind = 'fixed';
      else if (aResult.status === 'PASS' && bResult.status !== 'PASS') kind = 'new-failure';
      else if (aResult.status !== bResult.status) kind = 'status-changed';
      else if ((aResult.finalReply ?? '') !== (bResult.finalReply ?? '')) kind = 'reply-changed';
      return { caseId, name: aResult.caseName, aStatus: aResult.status, bStatus: bResult.status, kind };
    });
    const avg = (batch: EvalBatch) => {
      const results = resultsOf(batch);
      return results.length === 0 ? 0 : Math.round(results.reduce((sum, result) => sum + result.durationMs, 0) / results.length);
    };
    setComparison({
      comparable: reasons.length === 0,
      reasons,
      a,
      b,
      rows,
      averageDurationA: avg(a),
      averageDurationB: avg(b),
      passedDelta: b.passed - a.passed,
      failedDelta: b.failed - a.failed,
      reviewDelta: b.review - a.review,
      errorDelta: b.errors - a.errors,
    });
  }

  function openCreate() {

    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(evalCase: EvalCase) {
    setEditing(evalCase);
    setForm(formFromCase(evalCase));
    setFormOpen(true);
  }

  async function saveCase() {
    if (saving) return;
    if (!form.name.trim() || !form.question.trim()) {
      toast.error('名称和用户问题不能为空');
      return;
    }
    if (form.expectedPrice.trim() !== '' && !Number.isFinite(Number(form.expectedPrice))) {
      toast.error('期望价格必须是数字');
      return;
    }
    setSaving(true);
    try {
      const body = bodyFromForm(form);
      if (editing) {
        await fetchJson(`/api/eval/cases/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        toast.success('评测用例已保存');
      } else {
        await fetchJson('/api/eval/cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        toast.success('评测用例已创建');
      }
      setFormOpen(false);
      await load();
    } catch (caught) {
      toast.error('保存用例失败', { description: errorText(caught) });
    } finally {
      setSaving(false);
    }
  }

  async function toggleCase(evalCase: EvalCase) {
    try {
      await fetchJson(`/api/eval/cases/${evalCase.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !evalCase.enabled }),
      });
      await load();
    } catch (caught) {
      toast.error('切换用例状态失败', { description: errorText(caught) });
    }
  }

  async function deleteCase(evalCase: EvalCase) {
    if (!window.confirm(`确认删除评测用例「${evalCase.name}」？`)) return;
    try {
      await fetchJson(`/api/eval/cases/${evalCase.id}`, { method: 'DELETE' });
      toast.success('评测用例已删除');
      await load();
    } catch (caught) {
      toast.error('删除用例失败', { description: errorText(caught) });
    }
  }

  async function copyCase(evalCase: EvalCase) {
    try {
      await fetchJson(`/api/eval/cases/${evalCase.id}/copy`, { method: 'POST' });
      toast.success('用例已复制，默认停用');
      await load();
    } catch (caught) {
      toast.error('复制用例失败', { description: errorText(caught) });
    }
  }

  async function importFromRun() {
    if (fromRunSaving) return;
    setFromRunSaving(true);
    try {
      await fetchJson('/api/eval/from-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: fromRunId.trim(), name: fromRunName.trim() || undefined }),
      });
      toast.success('已从 Run 加入评测集');
      setFromRunOpen(false);
      setFromRunId('');
      setFromRunName('');
      await load();
    } catch (caught) {
      toast.error('从 Run 导入失败', { description: errorText(caught) });
    } finally {
      setFromRunSaving(false);
    }
  }

  async function executeCaseRun(evalCase: EvalCase): Promise<{ run: Run; score: DetailedEvalScore }> {
    let completedRun: Run | null = null;
    let streamError: string | null = null;
    await streamAgentRun(
      { userInput: evalCase.question, source: 'api', provider: 'auto' },
      (event) => {
        if (event.type === 'error') streamError = `${event.code} · ${event.error}`;
        if (event.type === 'done') completedRun = event.run;
      },
    );
    const run = completedRun as Run | null;
    if (!run) throw new Error(streamError ?? 'Agent 没有返回 done 事件');
    const scored = await fetchJson<DetailedEvalScoreResponse>('/api/eval/score/detailed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: evalCase.id, runId: run.id }),
    });
    return { run: scored.run, score: scored.score };
  }

  async function runSingleCase(evalCase: EvalCase) {
    if (runningCaseId) return;
    setRunningCaseId(evalCase.id);
    setCaseRunErrors((current) => ({ ...current, [evalCase.id]: '' }));
    try {
      const { run, score } = await executeCaseRun(evalCase);
      const result: EvalBatchCaseResult = {
        caseId: evalCase.id,
        caseName: evalCase.name,
        question: evalCase.question,
        status: score.status,
        finalReply: run.finalReply,
        reason: score.reason,
        runId: run.id,
        durationMs: score.durationMs,
        error: run.error,
        score,
      };
      setCaseRuns((current) => ({ ...current, [evalCase.id]: { result, run } }));
      setRunCache((current) => ({ ...current, [run.id]: run }));
      setCaseProcessOpen((current) => ({ ...current, [evalCase.id]: true }));
      toast.success('单条评测已完成', { description: `${evalCase.name} · ${score.totalScore} 分 · ${score.status}` });
    } catch (caught) {
      const message = caught instanceof AgentStreamError ? `${caught.code} · ${caught.message}` : errorText(caught);
      setCaseRunErrors((current) => ({ ...current, [evalCase.id]: message }));
      toast.error('单条评测运行失败', { description: message });
    } finally {
      setRunningCaseId(null);
    }
  }

  function runAllCases() {
    const enabled = cases.filter((item) => item.enabled).map((item) => item.id);
    if (enabled.length === 0) {
      toast.error('没有启用的评测用例');
      return;
    }
    setBatchForm({
      name: `全量评测 · ${new Date().toLocaleString('zh-CN')}`,
      versionLabel: 'all-enabled',
      changeNote: '手动创建：运行全部启用用例',
      caseIds: enabled,
    });
    setBatchOpen(true);
  }

  async function rerunProcessCase(evalCase: EvalCase, caseId: string) {
    if (rerunLoading) return;
    setRerunLoading(caseId);
    setRerunErrors((current) => ({ ...current, [caseId]: '' }));
    try {
      const { run, score } = await executeCaseRun(evalCase);
      const result: EvalBatchCaseResult = {
        caseId: evalCase.id,
        caseName: evalCase.name,
        question: evalCase.question,
        status: score.status,
        finalReply: run.finalReply,
        reason: score.reason,
        runId: run.id,
        durationMs: score.durationMs,
        error: run.error,
        score,
      };
      setRerunResults((current) => ({ ...current, [caseId]: { result, run } }));
      setRunCache((current) => ({ ...current, [run.id]: run }));
      setExpandedResults((current) => ({ ...current, [caseId]: true }));
      toast.success('重跑完成，已更新当前过程', { description: `${evalCase.name} · ${score.totalScore} 分 · ${score.status}` });
    } catch (caught) {
      const message = caught instanceof AgentStreamError ? `${caught.code} · ${caught.message}` : errorText(caught);
      setRerunErrors((current) => ({ ...current, [caseId]: message }));
      toast.error('重跑失败', { description: message });
    } finally {
      setRerunLoading(null);
    }
  }

  async function saveJudgeConfig() {
    if (judgeSaving) return;
    if (judgeDraft.trim().length < 20) {
      toast.error('Judge Prompt 至少需要 20 个字符');
      return;
    }
    setJudgeSaving(true);
    try {
      const result = await fetchJson<{ config: EvalConfig }>('/api/eval/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          judgeEnabled: judgeConfig?.judgeEnabled ?? false,
          judgeSystemPrompt: judgeDraft,
          judgeTemperature: judgeConfig?.judgeTemperature ?? 0.1,
        }),
      });
      setJudgeConfig(result.config);
      setJudgeDraft(result.config.judgeSystemPrompt);
      toast.success('LLM-as-Judge 配置已保存');
    } catch (caught) {
      toast.error('保存 Judge 配置失败', { description: errorText(caught) });
    } finally {
      setJudgeSaving(false);
    }
  }

  async function toggleJudgeEnabled(enabled: boolean) {
    if (!judgeConfig) return;
    try {
      const result = await fetchJson<{ config: EvalConfig }>('/api/eval/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ judgeEnabled: enabled }),
      });
      setJudgeConfig(result.config);
      toast.success(enabled ? '已启用 LLM-as-Judge' : '已停用 LLM-as-Judge');
    } catch (caught) {
      toast.error('切换 Judge 状态失败', { description: errorText(caught) });
    }
  }

  async function loadRunDetail(runId: string) {
    if (runCache[runId] || runLoading === runId) return;
    setRunLoading(runId);
    try {
      const detail = await fetchJson<RunDetailResponse>(`/api/runs/${encodeURIComponent(runId)}`);
      setRunCache((current) => ({ ...current, [runId]: detail.run }));
    } catch (caught) {
      toast.error('读取过程详情失败', { description: errorText(caught) });
    } finally {
      setRunLoading(null);
    }
  }

  async function toggleProcessDetail(result: EvalBatchCaseResult) {
    const key = result.caseId;
    const next = !expandedResults[key];
    setExpandedResults((current) => ({ ...current, [key]: next }));
    if (next && result.runId && !runCache[result.runId]) {
      await loadRunDetail(result.runId);
    }
  }


  async function toggleCaseProcess(caseId: string, result: EvalBatchCaseResult) {
    const next = !caseProcessOpen[caseId];
    setCaseProcessOpen((current) => ({ ...current, [caseId]: next }));
    if (next && result.runId && !runCache[result.runId]) {
      await loadRunDetail(result.runId);
    }
  }

  const latestByCase = new Map<string, { batchId: string; result: EvalBatchCaseResult }>();
  for (const batch of data?.batches ?? []) {
    for (const result of resultsOf(batch)) {
      if (!latestByCase.has(result.caseId)) {
        latestByCase.set(result.caseId, { batchId: batch.id, result });
      }
    }
  }
  for (const [caseId, entry] of Object.entries(caseRuns)) {
    latestByCase.set(caseId, { batchId: 'inline', result: entry.result });
  }
  const latestScores = [...latestByCase.values()].map((item) => scoreOf(item.result)).filter((item): item is DetailedEvalScore => Boolean(item));
  const executedCount = latestScores.length;
  const passCount = latestScores.filter((item) => item.passed).length;
  const detailedScores = latestScores.filter((item) => typeof item.totalScore === 'number' && item.dimensions);
  const averageScore = detailedScores.length === 0 ? 0 : Math.round((detailedScores.reduce((sum, item) => sum + item.totalScore, 0) / detailedScores.length) * 10) / 10;
  const passRate = executedCount === 0 ? 0 : Math.round((passCount / executedCount) * 1000) / 10;
  const processBatch = activeBatch ?? (data?.batches ?? []).find((batch) => batch.id === activeBatchId) ?? null;
  const processResults = processBatch ? resultsOf(processBatch) : [];
  const visibleResults = badCaseOnly ? processResults.filter((result) => result.status !== 'PASS') : processResults;

  if (loading) {
    return <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-8 text-xs text-muted-foreground"><LoaderCircle className="animate-spin" aria-hidden /> 正在读取评测中心…</div>;
  }

 return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="page-kicker">EVAL / REGRESSION LOOP</p>
          <h1 className="page-title">评测中心</h1>
          <p className="page-description">真实 Agent 主链路执行、六维规则评分与可选 LLM-as-Judge。Judge 未接通时明确展示规则评测，不伪造分数。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void load()}><RefreshCw aria-hidden /> 刷新</Button>
          <Button type="button" variant="outline" onClick={openCreate}><Plus aria-hidden /> 新增用例</Button>
          <Button type="button" variant="outline" onClick={() => setFromRunOpen(true)}><ArrowRight aria-hidden /> 从 Run 导入</Button>
          <Button type="button" onClick={() => void runAllCases()} disabled={runningCaseId !== null}>{runningCaseId === 'ALL' ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}运行全部</Button>
        </div>
      </header>

      <nav className="ops-tabs" role="tablist" aria-label="评测中心分区">
        <button type="button" role="tab" aria-selected={activeTab === 'cases'} className={`ops-tab ${activeTab === 'cases' ? 'ops-tab-active' : ''}`} onClick={() => setActiveTab('cases')}>评测集 <span className="ops-tab-count">{cases.length}</span></button>
        <button type="button" role="tab" aria-selected={activeTab === 'process'} className={`ops-tab ${activeTab === 'process' ? 'ops-tab-active' : ''}`} onClick={() => setActiveTab('process')}>评测运行过程 <span className="ops-tab-count">{processResults.length}</span></button>
        <button type="button" role="tab" aria-selected={activeTab === 'compare'} className={`ops-tab ${activeTab === 'compare' ? 'ops-tab-active' : ''}`} onClick={() => setActiveTab('compare')}>批次对比 <span className="ops-tab-count">{data?.batches.length ?? 0}</span></button>
      </nav>

      {error ? <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[11px] text-red-900"><AlertTriangle className="mt-0.5 size-3.5" aria-hidden />{error}</div> : null}

      {activeTab === 'cases' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Card><CardContent className="p-3"><p className="text-[10px] text-muted-foreground">用例总数</p><p className="mt-1 text-xl font-semibold">{cases.length}</p><p className="mt-1 text-[9px] text-muted-foreground">启用 {cases.filter((item) => item.enabled).length} · 停用 {cases.filter((item) => !item.enabled).length}</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] text-muted-foreground">已运行</p><p className="mt-1 text-xl font-semibold">{executedCount}</p><p className="mt-1 text-[9px] text-muted-foreground">最新结果去重</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] text-muted-foreground">通过率</p><p className="mt-1 text-xl font-semibold">{passRate}%</p><p className="mt-1 text-[9px] text-muted-foreground">{passCount} / {executedCount} 通过</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] text-muted-foreground">平均分</p><p className="mt-1 text-xl font-semibold">{averageScore}</p><p className="mt-1 text-[9px] text-muted-foreground">六维加权总分</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] text-muted-foreground">分类</p><p className="mt-1 text-xl font-semibold">{new Set(cases.map((item) => item.scenario)).size}</p><p className="mt-1 text-[9px] text-muted-foreground">场景 / 分类</p></CardContent></Card>
            <Card><CardContent className="p-3"><p className="text-[10px] text-muted-foreground">能力资产</p><p className="mt-1 text-xl font-semibold">{(data?.skills.length ?? 0)} / {(data?.tools.length ?? 0)}</p><p className="mt-1 text-[9px] text-muted-foreground">Skill / Tool</p></CardContent></Card>
          </div>

          <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="size-4 text-primary" aria-hidden />LLM-as-Judge 配置</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">统一启用/停用并维护 Judge 系统 Prompt；用例级 Judge 标准会追加在统一 Prompt 后。</p></CardHeader>
              <CardContent className="space-y-3">
                {judgeConfig ? (
                  <>
                    <label className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-[11px]"><span><span className="font-medium">启用 LLM-as-Judge</span><span className="mt-0.5 block text-[9px] text-muted-foreground">Judge 可用时回复层按 55% 精准 + 45% Judge；否则精准匹配 100%。</span></span><input type="checkbox" checked={judgeConfig.judgeEnabled} onChange={(event) => void toggleJudgeEnabled(event.target.checked)} /></label>
                    <label className="block text-[10px] text-muted-foreground">Judge 系统 Prompt（全局）<Textarea className="mt-1 font-mono text-[10px]" rows={8} value={judgeDraft} onChange={(event) => setJudgeDraft(event.target.value)} /></label>
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[9px] text-muted-foreground">classroom-fixture 不提供真实模型 Judge，不会伪造 Judge 分数；请切换真实 Provider。</p><Button type="button" size="sm" onClick={() => void saveJudgeConfig()} disabled={judgeSaving}>{judgeSaving ? <LoaderCircle className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}保存 Judge 配置</Button></div>
                  </>
                ) : <p className="text-[11px] text-muted-foreground">读取 Judge 配置中…</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>评分维度与权重</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">六维加权总分；启用人工评估时权重自动重排并追加人工评估 10%。</p></CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-3 gap-1 text-[9px] font-medium text-muted-foreground"><span>维度</span><span>基础 / 人工权重</span><span>计分规则</span></div>
                {[
                  ['Planner', '20% / 18%', '100 − 缺少期望能力×30 − 误用禁止能力×35 − risk-check 非最后×50'],
                  ['Skill', '15% / 14%', '100 − 执行失败 Skill×50；全部成功 100'],
                  ['Tool', '25% / 23%', '期望 Tool 事实命中率 − 缺失价格 Tool×25 − 价格早于推荐×30'],
                  ['回复', '25% / 23%', '无 Judge：精准匹配 100%；有 Judge：55% 精准 + 45% Judge；禁用表述每个 −35'],
                  ['风控', '10% / 9%', '强制通过：通过 100 / 不通过 0；非强制：risk-check 最后一步 100 / 否则 0'],
                  ['性能', '5% / 3%', '100 − 超出 maxLatencyMs 的比例 × 100；未超上限 100'],
                ].map(([name, weights, rule]) => <div key={name} className="grid grid-cols-3 gap-1 rounded border px-2 py-1.5 text-[9px]"><span className="font-semibold">{name}</span><span>{weights}</span><span className="leading-4 text-muted-foreground">{rule}</span></div>)}
                <div className="rounded-md bg-muted/40 px-2.5 py-2 text-[10px] leading-5"><p><strong>人工评估追加 10%：</strong>100 − Σ 低于 3 分且问题仍存在的维度 (3 − 原分) × 12。</p><p className="mt-1"><strong>总分：</strong>六维加权分求和 + 人工评估加权，四舍五入到 0–100；通过线 80。</p></div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>回复评分方法</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">机器规则、余弦相似度、模型裁判和人工复核共同构成评测闭环；只有精准匹配与有效 Judge 进入回复分。</p></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border px-2.5 py-2 text-[10px] leading-5"><p className="font-semibold">精准匹配</p><p className="mt-1 text-muted-foreground">关键点、Tool 事实、禁用表述、能力调用精确命中。回复层无 Judge 时 100%，有 Judge 时 55%。</p></div>
              <div className="rounded-md border px-2.5 py-2 text-[10px] leading-5"><p className="font-semibold">余弦相似度</p><p className="mt-1 text-muted-foreground">expectedReply 与实际回复的词袋/字符向量相似度，仅辅助诊断，不进入总分。</p></div>
              <div className="rounded-md border px-2.5 py-2 text-[10px] leading-5"><p className="font-semibold">LLM-as-Judge</p><p className="mt-1 text-muted-foreground">按统一 Prompt 与用例标准评估相关性、完整性、事实准确性和表达质量；有效分占回复层 45%。</p></div>
              <div className="rounded-md border px-2.5 py-2 text-[10px] leading-5"><p className="font-semibold">人工评估</p><p className="mt-1 text-muted-foreground">Bad Case、低分服务、标注审核沉淀六维质量结论；追加 10% 权重，不自动替代机器分。</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
              <div><CardTitle className="flex items-center gap-2"><FlaskConical className="size-4 text-primary" aria-hidden />评测集列表</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">{filtered.length} 条匹配用例 · 默认显示启用用例；单条运行与查看过程均在当前页面展开，不新建批次。</p></div>
              <div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={() => void runAllCases()} disabled={runningCaseId !== null}><Play aria-hidden />运行全部</Button><Button type="button" size="sm" variant="outline" onClick={openCreate}><Plus aria-hidden />新增</Button><Button type="button" size="sm" variant="outline" onClick={() => setFromRunOpen(true)}>从 Run 导入</Button></div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <select className="field-select" value={filters.enabled} onChange={(event) => setFilters({ ...filters, enabled: event.target.value })}><option value="enabled">启用用例</option><option value="all">全部状态</option><option value="disabled">停用用例</option></select>
                <select className="field-select" value={filters.scenario} onChange={(event) => setFilters({ ...filters, scenario: event.target.value })}><option value="">全部分类</option>{scenarios.map((scenario) => <option key={scenario} value={scenario}>{scenario}</option>)}</select>
                <select className="field-select" value={filters.difficulty} onChange={(event) => setFilters({ ...filters, difficulty: event.target.value })}><option value="">全部难度</option><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option></select>
                <select className="field-select" value={filters.riskLevel} onChange={(event) => setFilters({ ...filters, riskLevel: event.target.value })}><option value="">全部风险</option><option value="none">none</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select>
                <select className="field-select" value={filters.dimension} onChange={(event) => setFilters({ ...filters, dimension: event.target.value })}><option value="">全部维度</option>{Object.entries(DIMENSION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </div>
              <div className="space-y-2">
                {filtered.length === 0 ? <div className="rounded-lg border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">暂无匹配用例</div> : filtered.map((evalCase) => {
                  const latest = latestByCase.get(evalCase.id);
                  const score = latest ? scoreOf(latest.result) : null;
                  const inlineOpen = Boolean(caseProcessOpen[evalCase.id]);
                  const inlineRun = latest?.result.runId ? runCache[latest.result.runId] ?? null : null;
                  return (
                    <div key={evalCase.id} className="rounded-lg border bg-card px-3 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5"><Badge tone={evalCase.enabled ? 'success' : 'neutral'}>{evalCase.enabled ? '启用' : '停用'}</Badge><Badge tone="neutral">{evalCase.scenario}</Badge><Badge tone="neutral">{DIFFICULTY_LABEL[evalCase.difficulty]}</Badge><Badge tone={evalCase.riskLevel === 'high' ? 'danger' : evalCase.riskLevel === 'medium' ? 'warning' : 'success'}>risk {RISK_LABEL[evalCase.riskLevel]}</Badge><Badge tone="accent">{DIMENSION_LABEL[evalCase.evalDimension]}</Badge><span className="text-xs font-semibold">{evalCase.name}</span>{score ? <Badge tone={statusTone(score.status)}>{score.status}{typeof score.totalScore === 'number' ? ` · ${score.totalScore} 分` : ''} · {score.passed ? '通过' : '未通过'}</Badge> : <Badge tone="neutral">未运行</Badge>}</div>
                          <p className="mt-1.5 text-[11px] leading-5">{evalCase.question}</p>
                          <p className="mt-1 text-[10px] leading-5 text-muted-foreground">期望回复：{evalCase.expectedReply || '—'} · 评分方法：{judgeConfig?.judgeEnabled ? '规则 + Judge（可用时）' : '规则评测（Judge 未启用）'}</p>
                          <p className="mt-0.5 text-[10px] leading-5 text-muted-foreground">期望关键词：{evalCase.expectedKeywords.join(' / ') || '—'} · 禁用表述：{evalCase.forbiddenWords.join(' / ') || '—'} · 价格：{evalCase.expectedPrice ?? '—'} · 最大耗时：{evalCase.maxLatencyMs}ms</p>
                          <p className="mt-0.5 text-[10px] leading-5 text-muted-foreground">期望能力：{evalCase.requiredCapabilities.join(' / ') || '—'} · 期望 Tool 事实：{evalCase.expectedToolFacts.join(' / ') || '—'} · 风控结果：{score ? `${score.inputRiskLevel} / ${score.replySafe ? '安全' : '危险'}` : '未运行'} · 本次耗时：{score ? `${score.durationMs}ms` : '未运行'}</p>
                          {evalCase.humanScores ? <p className="mt-0.5 text-[10px] leading-5 text-amber-800">人工六维：正确性 {evalCase.humanScores.correctness} · 相关性 {evalCase.humanScores.relevance} · 完整性 {evalCase.humanScores.completeness} · 安全 {evalCase.humanScores.safety} · 语气 {evalCase.humanScores.tone} · 综合 {evalCase.humanScores.overall}</p> : null}
                          <div className="mt-1.5"><DimensionScores score={score} /><CalculationLine score={score} /></div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Button type="button" size="sm" onClick={() => void runSingleCase(evalCase)} disabled={runningCaseId !== null}>{runningCaseId === evalCase.id ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}{runningCaseId === evalCase.id ? '运行中…' : '运行'}</Button>
                          {latest ? <Button type="button" size="sm" variant="outline" onClick={() => void toggleCaseProcess(evalCase.id, latest.result)}>{inlineOpen ? '收起过程' : '查看过程'}</Button> : null}
                          <Button type="button" size="sm" variant="outline" onClick={() => openEdit(evalCase)}><Pencil aria-hidden /> 编辑</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => void copyCase(evalCase)}><Copy aria-hidden /> 复制</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => void toggleCase(evalCase)}>{evalCase.enabled ? '停用' : '启用'}</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => void deleteCase(evalCase)}><Trash2 aria-hidden /> 删除</Button>
                        </div>
                      </div>
                      {caseRunErrors[evalCase.id] ? <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] text-red-900">ERROR · {caseRunErrors[evalCase.id]}</div> : null}
                      {inlineOpen && latest ? <InlineCaseProcess result={latest.result} evalCase={evalCase} run={inlineRun} loading={runLoading === latest.result.runId} /> : null}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {activeTab === 'process' ? (
        <>
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
              <div><CardTitle className="flex items-center gap-2"><FlaskConical className="size-4 text-primary" aria-hidden />评测运行过程</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">逐条真实 Agent 执行；单条 ERROR 不阻断批次。展开可查看输入、最终回复、精准匹配、余弦、Judge、人工评估、问题、Planner 摘要和完整步骤。</p></div>
              <div className="flex flex-wrap gap-2"><select className="field-select max-w-[300px]" value={activeBatchId ?? ''} onChange={(event) => { const id = event.target.value; setActiveBatchId(id); setActiveBatch((data?.batches ?? []).find((batch) => batch.id === id) ?? null); }}><option value="">选择批次</option>{(data?.batches ?? []).map((batch) => <option key={batch.id} value={batch.id}>{batch.name} · {batch.versionLabel}</option>)}</select>{processBatch ? <Button type="button" size="sm" variant="outline" onClick={() => void deleteBatchItem(processBatch)}><Trash2 aria-hidden />删除当前批次</Button> : null}<Button type="button" size="sm" onClick={() => void runAllCases()} disabled={runningCaseId !== null}><Play aria-hidden />运行全部</Button></div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-5 text-amber-900">当前实际评测方式：规则评测{judgeConfig?.judgeEnabled ? ' + LLM-as-Judge（若 Provider 可用）' : '，Judge 未启用'}。Judge 无有效分数时回复层按精准匹配 100%，不伪造 Judge 分数。</div>
              {batchError ? <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] text-red-900">轮询失败：{batchError}。已停止自动轮询。</div> : null}
              {processBatch ? (
                <>
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={batchStatusTone(processBatch.status)}>{batchStatusLabel(processBatch.status)}</Badge><span className="text-xs font-semibold">{processBatch.name}</span><span className="text-[10px] text-muted-foreground">{processBatch.versionLabel} · {processBatch.currentIndex}/{processBatch.total || processBatch.caseCount} · 通过率 {processBatch.passRate}% · PASS {processBatch.passed} / FAIL {processBatch.failed} / REVIEW {processBatch.review} / ERROR {processBatch.errors}</span><span className="text-[10px] text-muted-foreground">{processBatch.provider} / {processBatch.model}</span></div>
                  <div className="flex flex-wrap gap-1.5"><button type="button" className={`rounded-md border px-2 py-1 text-[10px] ${!badCaseOnly ? 'border-primary bg-primary/5' : ''}`} onClick={() => setBadCaseOnly(false)}>全部数据</button><button type="button" className={`rounded-md border px-2 py-1 text-[10px] ${badCaseOnly ? 'border-primary bg-primary/5' : ''}`} onClick={() => setBadCaseOnly(true)}>Bad Case（非 PASS）</button><span className="text-[9px] text-muted-foreground">显示 {visibleResults.length} / {processResults.length} 条</span></div>
                  {visibleResults.length === 0 ? <div className="rounded-lg border border-dashed px-4 py-7 text-center text-[11px] text-muted-foreground">{processResults.length === 0 ? '批次执行中，暂无结果。' : '没有 Bad Case。'}</div> : visibleResults.map((result) => {
                    const rerun = rerunResults[result.caseId];
                    const effective = rerun?.result ?? result;
                    const key = result.caseId;
                    const expanded = Boolean(expandedResults[key]);
                    const score = scoreOf(effective);
                    const detailCase = processBatch.caseSnapshot.find((item) => item.id === result.caseId) ?? null;
                    const detailRun = rerun?.run ?? (effective.runId ? runCache[effective.runId] : null);
                    return (
                      <div key={key} className="rounded-lg border bg-card px-3 py-2.5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5"><Badge tone={statusTone(effective.status)}>{effective.status}</Badge><span className="text-xs font-semibold">{result.caseName}</span>{score ? <Badge tone={score.passed ? 'success' : 'danger'}>{typeof score.totalScore === 'number' ? `${score.totalScore} 分` : '历史分数'} · {score.passed ? '通过' : '未通过'}</Badge> : null}<span className="text-[9px] text-muted-foreground">{detailCase?.scenario ?? '—'} · {score?.sourceLabel ?? '—'} · {score?.runCreatedAt ? formatDateTime(score.runCreatedAt) : '—'} · {effective.durationMs}ms · {score?.stepCount ?? 0} 步</span></div>
                            <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{result.question}</p>
                            <div className="mt-1.5"><DimensionScores score={score} /><CalculationLine score={score} /></div>
                          </div>
                          <div className="flex flex-wrap gap-1.5"><Button type="button" size="sm" variant="outline" onClick={() => void toggleProcessDetail(effective)}>{expanded ? '折叠过程' : '查看过程'}</Button><Button type="button" size="sm" variant="outline" onClick={() => detailCase ? void rerunProcessCase(detailCase, result.caseId) : undefined} disabled={!detailCase || rerunLoading === result.caseId}>{rerunLoading === result.caseId ? <LoaderCircle className="animate-spin" aria-hidden /> : null}重跑</Button>{effective.runId ? <Link href={`/runs/${effective.runId}`} className="inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-medium text-primary hover:underline">Trace</Link> : null}</div>
                        </div>
                        {rerun ? <p className="mt-1 text-[9px] text-amber-800">重跑结果仅更新当前展开内容，未写回批次统计。</p> : null}
                        {rerunErrors[result.caseId] ? <div className="mt-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-900">ERROR · {rerunErrors[result.caseId]}</div> : null}
                        {expanded ? (
                          <div className="mt-2 space-y-2 border-t pt-2">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="rounded-md bg-muted/40 px-2.5 py-2"><p className="text-[9px] font-medium text-muted-foreground">评测输入</p><p className="mt-1 whitespace-pre-wrap text-[10px] leading-5">{detailCase?.question ?? result.question}</p></div>
                              <div className="rounded-md bg-muted/40 px-2.5 py-2"><p className="text-[9px] font-medium text-muted-foreground">最终回复</p><p className="mt-1 whitespace-pre-wrap text-[10px] leading-5">{effective.finalReply ?? '（无最终回复）'}</p></div>
                            </div>
                            {score ? (
                              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-md border px-2 py-1.5 text-[10px]"><p className="font-semibold">精准匹配 · {score.precision?.score ?? '—'}</p><p className="mt-1 text-muted-foreground">命中 {score.precision?.keywordHits?.join(' / ') || '—'}</p><p className="text-muted-foreground">缺失 {score.precision?.keywordMisses?.join(' / ') || '—'}</p><p className="text-muted-foreground">禁用表述 {score.precision?.forbiddenHits?.join(' / ') || '—'}</p></div>
                                <div className="rounded-md border px-2 py-1.5 text-[10px]"><p className="font-semibold">余弦相似度 · {score.cosine?.score ?? '—'}</p><p className="mt-1 text-muted-foreground">{score.cosine?.method ?? '未计算'}</p><p className="text-muted-foreground">{score.cosine?.detail ?? '未计算'}</p></div>
                                <div className="rounded-md border px-2 py-1.5 text-[10px]"><p className="font-semibold">LLM-as-Judge · {score.judge?.score ?? '—'}</p><p className="mt-1 text-muted-foreground">启用：{score.judge?.enabled ? '是' : '否'} · {score.judge?.provider ?? '—'}</p><p className="text-muted-foreground">{score.judge?.error ?? score.judge?.reason ?? '未执行'}</p><p className="mt-1 text-muted-foreground">{score.judge?.prompt?.slice(0, 120) ?? ''}</p></div>
                                <div className="rounded-md border px-2 py-1.5 text-[10px]"><p className="font-semibold">人工评估 · {score.human?.score ?? '—'}</p><p className="mt-1 text-muted-foreground">启用：{score.human?.enabled ? '是' : '否'} · 权重 {Math.round((score.human?.weight ?? 0) * 100)}%</p><p className="text-muted-foreground">{score.human?.details?.join('；') || '无六维人工标注'}</p></div>
                              </div>
                            ) : null}
                            <DimensionReasons score={score} />
                            {score?.issues?.length ? <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900"><span className="font-semibold">发现的问题：</span>{score.issues.join('；')}</div> : null}
                            <div className="rounded-md bg-muted/40 px-2.5 py-2 text-[10px] leading-5"><span className="font-semibold">Planner 摘要：</span>{score?.plannerSummary ?? '无'}</div>
                            <div className="rounded-md border px-2.5 py-2">
                              <p className="text-[10px] font-semibold">执行步骤（{detailRun?.steps.length ?? score?.stepCount ?? 0}）</p>
                              {runLoading === effective.runId ? <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><LoaderCircle className="size-3 animate-spin" aria-hidden />读取 Trace…</p> : null}
                              <div className="mt-1 space-y-1">
                                {(detailRun?.steps ?? []).map((step) => <details key={step.id} className="rounded-md border bg-card px-2 py-1.5 text-[10px]"><summary className="cursor-pointer"><Badge tone={step.status === 'ERROR' ? 'danger' : 'success'}>{step.status}</Badge> <span className="ml-1 font-mono">{step.type} · {step.capabilityId}</span><span className="ml-2 text-muted-foreground">{step.durationMs}ms</span></summary><div className="mt-1 grid gap-1 sm:grid-cols-2"><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-1.5">{JSON.stringify(step.input, null, 2)}</pre><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-1.5">{JSON.stringify(step.output, null, 2)}</pre></div></details>)}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </>
              ) : <div className="rounded-lg border border-dashed px-4 py-8 text-center text-[11px] text-muted-foreground">暂无运行批次。点击“运行全部”或评测集中的“运行”开始。</div>}
            </CardContent>
          </Card>
        </>
      ) : null}

      {activeTab === 'compare' ? (
        <>
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2"><div><CardTitle>批次对比</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">原有批次对比迁移至此。caseIds、用例快照、评分器或运行条件不同会显示“不可直接比较”。</p></div><Button type="button" size="sm" variant="outline" onClick={openBatchModal}><Plus aria-hidden /> 自定义批次</Button></CardHeader>
            <CardContent className="space-y-2">
              {(data?.batches ?? []).length === 0 ? <div className="rounded-lg border border-dashed px-4 py-6 text-center text-[11px] text-muted-foreground">暂无批次</div> : (data?.batches ?? []).map((batch) => <div key={batch.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-[10px] hover:border-primary/50"><button type="button" onClick={() => { setActiveBatchId(batch.id); setActiveBatch(batch); setActiveTab('process'); }} className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 text-left"><span className="flex flex-wrap items-center gap-2"><Badge tone={batchStatusTone(batch.status)}>{batchStatusLabel(batch.status)}</Badge><span className="font-medium">{batch.name}</span><span className="text-muted-foreground">{batch.versionLabel} · {batch.caseCount} 用例 · {batch.provider} / {batch.model}</span></span><span className="text-muted-foreground">PASS {batch.passed} · FAIL {batch.failed} · REVIEW {batch.review} · ERROR {batch.errors} · 通过率 {batch.passRate}%</span></button><Button type="button" size="sm" variant="outline" onClick={() => void deleteBatchItem(batch)} title="删除批次"><Trash2 aria-hidden />删除</Button></div>)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><RefreshCw className="size-4 text-primary" aria-hidden />版本对比</CardTitle><p className="text-[11px] leading-5 text-muted-foreground">只比较条件一致的完整批次；不会基于总分上涨直接给出“版本变好”的结论。</p></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <select className="field-select" value={compareA} onChange={(event) => setCompareA(event.target.value)}><option value="">选择基线批次</option>{(data?.batches ?? []).map((batch) => <option key={batch.id} value={batch.id}>{batch.name} · {batch.versionLabel}</option>)}</select>
                <select className="field-select" value={compareB} onChange={(event) => setCompareB(event.target.value)}><option value="">选择对比批次</option>{(data?.batches ?? []).map((batch) => <option key={batch.id} value={batch.id}>{batch.name} · {batch.versionLabel}</option>)}</select>
                <Button type="button" variant="outline" onClick={compareBatches}>比较</Button>
              </div>
              {comparison ? (
                <div className="space-y-2 rounded-md border p-3">
                  {!comparison.comparable ? <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900"><p className="font-semibold">不可直接比较</p><p className="mt-1">{comparison.reasons.join('；')}</p><p className="mt-1">不会基于这两个批次给出“版本变好/变差”的结论。</p></div> : (
                    <>
                      <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4"><div className="rounded-md bg-muted/50 px-2 py-1.5"><p className="text-muted-foreground">通过率</p><p className="font-semibold">{comparison.a.passRate}% → {comparison.b.passRate}%</p></div><div className="rounded-md bg-muted/50 px-2 py-1.5"><p className="text-muted-foreground">PASS 变化</p><p className="font-semibold">{comparison.passedDelta >= 0 ? '+' : ''}{comparison.passedDelta}</p></div><div className="rounded-md bg-muted/50 px-2 py-1.5"><p className="text-muted-foreground">新增失败</p><p className="font-semibold">{comparison.rows.filter((row) => row.kind === 'new-failure').length}</p></div><div className="rounded-md bg-muted/50 px-2 py-1.5"><p className="text-muted-foreground">平均耗时</p><p className="font-semibold">{comparison.averageDurationA}ms → {comparison.averageDurationB}ms</p></div></div>
                      <p className="text-[10px] text-muted-foreground">状态数量：A PASS {comparison.a.passed} / FAIL {comparison.a.failed} / REVIEW {comparison.a.review} / ERROR {comparison.a.errors} → B PASS {comparison.b.passed} / FAIL {comparison.b.failed} / REVIEW {comparison.b.review} / ERROR {comparison.b.errors}</p>
                      <p className="text-[10px] text-muted-foreground">Provider：{comparison.a.provider} / {comparison.a.model} = {comparison.b.provider} / {comparison.b.model} · evaluator {comparison.a.evaluatorVersion} = {comparison.b.evaluatorVersion} · params {JSON.stringify(comparison.a.params)} = {JSON.stringify(comparison.b.params)}</p>
                      <div className="grid gap-1.5 sm:grid-cols-2">{comparison.rows.filter((row) => row.kind !== 'same').length === 0 ? <p className="text-[10px] text-muted-foreground">没有状态或回复变化。</p> : comparison.rows.filter((row) => row.kind !== 'same').map((row) => <div key={row.caseId} className="rounded-md border px-2 py-1.5 text-[10px]"><Badge tone={row.kind === 'fixed' ? 'success' : row.kind === 'new-failure' ? 'danger' : 'warning'}>{row.kind === 'fixed' ? '已修复' : row.kind === 'new-failure' ? '新增失败' : row.kind === 'reply-changed' ? '回复变化' : '状态变化'}</Badge><span className="ml-1">{row.name}：{row.aStatus} → {row.bStatus}</span></div>)}</div>
                    </>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Dialog open={formOpen} onOpenChange={setFormOpen} title={editing ? '编辑评测用例' : '新增评测用例'} description="字段校验后写入 eval_cases.json；maxLatencyMs 参与性能维度。" className="max-w-4xl">
        <CaseFields form={form} setForm={setForm} />
        <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setFormOpen(false)}>取消</Button><Button type="button" onClick={() => void saveCase()} disabled={saving}>{saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}{saving ? '保存中…' : '保存用例'}</Button></div>
      </Dialog>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen} title="创建自定义批次" description="选择 caseIds；空数组会被 API 拒绝。批次结果写入评测运行过程。" className="max-w-3xl">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3"><Input value={batchForm.name} onChange={(event) => setBatchForm({ ...batchForm, name: event.target.value })} placeholder="批次名称（可选）" /><Input value={batchForm.versionLabel} onChange={(event) => setBatchForm({ ...batchForm, versionLabel: event.target.value })} placeholder="版本标签" /><Input value={batchForm.changeNote} onChange={(event) => setBatchForm({ ...batchForm, changeNote: event.target.value })} placeholder="变更说明" /></div>
          <div className="max-h-[320px] space-y-1 overflow-auto rounded-md border p-2">{cases.map((evalCase) => <label key={evalCase.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-muted/50"><input type="checkbox" checked={batchForm.caseIds.includes(evalCase.id)} onChange={(event) => setBatchForm((current) => ({ ...current, caseIds: event.target.checked ? [...current.caseIds, evalCase.id] : current.caseIds.filter((id) => id !== evalCase.id) }))} /><span className="font-medium">{evalCase.name}</span><span className="text-muted-foreground">{evalCase.scenario} · {evalCase.difficulty}</span>{!evalCase.enabled ? <Badge tone="neutral">停用</Badge> : null}</label>)}</div>
          <p className="text-[10px] text-muted-foreground">已选 {batchForm.caseIds.length} 条；评分器快照和用例快照会保存到批次。</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setBatchOpen(false)}>取消</Button><Button type="button" onClick={() => void startBatch()} disabled={batchCreating || batchForm.caseIds.length === 0}>{batchCreating ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}{batchCreating ? '创建中…' : '创建并开始'}</Button></div>
        </div>
      </Dialog>

      <Dialog open={fromRunOpen} onOpenChange={setFromRunOpen} title="从 Run 加入评测集" description="使用真实 Run 的问题与能力生成用例；不会把当前最终回复当作期望回复。" className="max-w-xl">
        <div className="space-y-3"><Input value={fromRunId} onChange={(event) => setFromRunId(event.target.value)} placeholder="runId，例如 run-..." /><Input value={fromRunName} onChange={(event) => setFromRunName(event.target.value)} placeholder="用例名称（可选）" /><p className="text-[10px] text-muted-foreground">也可以从运行详情页点击“加入评测集”。</p><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setFromRunOpen(false)}>取消</Button><Button type="button" onClick={() => void importFromRun()} disabled={fromRunSaving || !fromRunId.trim()}>{fromRunSaving ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plus aria-hidden />}{fromRunSaving ? '导入中…' : '导入'}</Button></div></div>
      </Dialog>
    </div>
  );
}
