'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest, formatDateTime, jsonBody } from '@/lib/client';
import type {
  SkillConfigCheck,
  SkillDetail,
  SkillTest,
  SkillTestExecutionResponse,
  SkillTestHistoryResponse,
} from '@/lib/types';

const SAMPLE_PRESETS = [
  {
    label: '商品推荐',
    value: '给同事买点不辣的办公室零食，预算 100 元以内。',
  },
  {
    label: '价格试算',
    value: '我买 3 份每日混合坚果，叠加满 99 减 20 和 SNACK20 优惠券，最后多少钱？',
  },
  {
    label: '订单物流',
    value: '帮我查一下订单 SN202610170014 的物流到哪了？',
  },
  {
    label: '过敏风险',
    value: '这款混合坚果含花生吗？孩子对花生过敏，能吃吗？',
  },
  {
    label: '诈骗风险',
    value: '收到短信说我中奖了，让我提供验证码并转账保证金，是真的吗？',
  },
];

function defaultSample(skill: SkillDetail): string {
  if (skill.requiredTools.includes('query_orders') || skill.requiredTools.includes('query_logistics')) {
    return SAMPLE_PRESETS[2].value;
  }
  if (skill.requiredTools.includes('calculate_price')) return SAMPLE_PRESETS[1].value;
  return SAMPLE_PRESETS[0].value;
}

function StatusBadge({ status }: { status: SkillTest['status'] }) {
  return status === 'SUCCESS' ? (
    <Badge tone="success">成功</Badge>
  ) : (
    <Badge tone="danger">错误</Badge>
  );
}

function ConfigBlock({ config }: { config: SkillConfigCheck }) {
  return (
    <section className="skill-test-section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="agent-section-title flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            配置检查
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            `{config.filePath}` · {config.promptLength} 字符 · hash {config.hash.slice(0, 12)}…
          </p>
        </div>
        <Badge tone={config.valid ? 'success' : 'danger'}>
          {config.valid ? '配置可用' : '依赖未满足'}
        </Badge>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="agent-label">依赖工具</p>
          {config.dependencies.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">本 Skill 不依赖 Tool，可以直接测试。</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {config.dependencies.map((dependency) => (
                <li key={dependency.toolId} className="flex flex-wrap items-center gap-2 text-[10px]">
                  <Badge
                    tone={
                      dependency.status === 'READY'
                        ? 'success'
                        : dependency.status === 'DISABLED'
                          ? 'warning'
                          : 'danger'
                    }
                  >
                    {dependency.status === 'READY'
                      ? '可用'
                      : dependency.status === 'DISABLED'
                        ? '已停用'
                        : '缺失'}
                  </Badge>
                  <span className="font-mono">{dependency.toolId}</span>
                  <span className="text-muted-foreground">{dependency.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="agent-label">检查结果</p>
          {config.issues.length === 0 ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-800">
              <CheckCircle2 className="size-3.5" aria-hidden />
              文件、Prompt 和必要工具均满足运行条件。
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {config.issues.map((issue) => (
                <li
                  key={`${issue.code}-${issue.message}`}
                  className={`flex items-start gap-1.5 text-[10px] leading-5 ${
                    issue.severity === 'error' ? 'text-red-700' : 'text-amber-800'
                  }`}
                >
                  {issue.severity === 'error' ? (
                    <XCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  ) : (
                    <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  )}
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!config.valid ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-5 text-amber-900">
          工具依赖不满足时，测试会记录 ERROR，不会把整条 Agent 运行冒充为单项测试。
        </p>
      ) : null}
    </section>
  );
}

function TestResult({ test }: { test: SkillTest }) {
  return (
    <section className="skill-test-section">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="agent-section-title flex items-center gap-2">
            {test.status === 'SUCCESS' ? (
              <CheckCircle2 className="size-4 text-emerald-700" aria-hidden />
            ) : (
              <AlertCircle className="size-4 text-red-700" aria-hidden />
            )}
            单项测试结果
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            v{test.skillVersion} · {test.provider} / {test.model} · {formatDateTime(test.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={test.status} />
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock3 className="size-3" aria-hidden />
            {test.durationMs}ms
          </span>
        </div>
      </div>

      {test.error ? (
        <div role="alert" className="mt-3 alert alert-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>{test.error}</span>
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <p className="agent-label">输入</p>
          <pre className="json-block mt-1 whitespace-pre-wrap">{test.input}</pre>
        </div>
        <div>
          <p className="agent-label">输出</p>
          <pre className="json-block mt-1 whitespace-pre-wrap">{test.output ?? '无输出'}</pre>
        </div>
      </div>

      {test.toolRuns.length > 0 ? (
        <div className="mt-3">
          <p className="agent-label">必要工具上下文</p>
          <ul className="mt-1.5 space-y-1.5">
            {test.toolRuns.map((run) => (
              <li key={`${test.id}-${run.toolId}`} className="flex flex-wrap items-center gap-2 text-[10px]">
                <Badge tone={run.status === 'SUCCESS' ? 'success' : 'danger'}>
                  {run.status === 'SUCCESS' ? '成功' : '错误'}
                </Badge>
                <span className="font-mono">{run.toolId}</span>
                <span className="text-muted-foreground">{run.durationMs}ms</span>
                {run.error ? <span className="text-red-700">{run.error}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function SkillTestPanel({ skill }: { skill: SkillDetail }) {
  const [config, setConfig] = useState<SkillConfigCheck | null>(null);
  const [tests, setTests] = useState<SkillTest[]>([]);
  const [sampleInput, setSampleInput] = useState(() => defaultSample(skill));
  const [selectedTest, setSelectedTest] = useState<SkillTest | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await apiRequest<SkillTestHistoryResponse>(
        `/api/skills/${encodeURIComponent(skill.id)}/test`,
      );
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfig(result.data.config);
      setTests(result.data.tests);
      setSelectedTest(result.data.tests[0] ?? null);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [skill.id]);

  async function checkConfig() {
    setChecking(true);
    setError(null);
    const result = await apiRequest<SkillTestHistoryResponse>(
      `/api/skills/${encodeURIComponent(skill.id)}/test`,
    );
    setChecking(false);
    if (!result.ok) {
      setError(result.error);
      toast.error('配置检查失败', { description: result.error });
      return;
    }
    setConfig(result.data.config);
    setTests(result.data.tests);
    toast.success('配置检查完成', {
      description: result.data.config.valid ? '必要工具与 Prompt 满足运行条件。' : '存在依赖或配置问题。',
    });
  }

  async function runTest() {
    if (running) return;
    if (!sampleInput.trim()) {
      toast.error('请填写测试样本');
      return;
    }
    setRunning(true);
    setError(null);
    const result = await apiRequest<SkillTestExecutionResponse>(
      `/api/skills/${encodeURIComponent(skill.id)}/test`,
      {
        method: 'POST',
        body: jsonBody({ sampleInput: sampleInput.trim() }),
      },
    );
    setRunning(false);
    if (!result.ok) {
      setError(result.error);
      toast.error('单项测试请求失败', { description: result.error });
      return;
    }
    setConfig(result.data.config);
    setSelectedTest(result.data.test);
    setTests((current) => [
      result.data.test,
      ...current.filter((item) => item.id !== result.data.test.id),
    ].slice(0, 20));
    if (result.data.test.status === 'SUCCESS') {
      toast.success('单项测试通过', {
        description: `${skill.name} · ${result.data.test.durationMs}ms`,
      });
    } else {
      toast.error('单项测试返回错误', {
        description: result.data.test.error ?? '请查看测试结果',
      });
    }
  }

  if (loading) {
    return (
      <div role="status" className="empty-state">
        <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden />
        <p className="text-xs">正在加载配置检查与测试历史…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">单独测试这个 Skill</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            只调用当前生效的 Skill 版本、Prompt、模型参数和必要 Tool；不经过 Planner，也不代表整条 Agent 运行成功。
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={checkConfig} disabled={checking || running}>
            {checking ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            {checking ? '检查中…' : '检查配置'}
          </Button>
          <Button type="button" size="sm" onClick={runTest} disabled={running}>
            {running ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}
            {running ? '运行中…' : '运行单项测试'}
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="alert alert-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {config ? <ConfigBlock config={config} /> : null}

      <section className="skill-test-section">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="field-group min-w-0 flex-1">
            <span className="field-label">测试样本</span>
            <select
              className="field-select"
              value=""
              onChange={(event) => {
                if (event.target.value) setSampleInput(event.target.value);
              }}
              aria-label="选择示例样本"
            >
              <option value="">选择示例样本…</option>
              {SAMPLE_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          {skill.requiredTools.length > 0 ? (
            <Badge tone="neutral">
              <Wrench className="size-3" aria-hidden />
              {skill.requiredTools.length} 个必要 Tool
            </Badge>
          ) : (
            <Badge tone="neutral">无 Tool 依赖</Badge>
          )}
        </div>
        <Textarea
          value={sampleInput}
          onChange={(event) => setSampleInput(event.target.value)}
          className="mt-2 min-h-[100px]"
          placeholder="输入用来单独测试此 Skill 的用户消息。"
          maxLength={6000}
        />
      </section>

      {selectedTest ? <TestResult test={selectedTest} /> : null}

      <section className="skill-test-section">
        <div className="flex items-center justify-between gap-2">
          <p className="agent-section-title">测试记录</p>
          <Badge tone="neutral">{tests.length} 条</Badge>
        </div>
        {tests.length === 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground">还没有单项测试记录。</p>
        ) : (
          <ul className="mt-2 divide-y">
            {tests.map((test) => (
              <li key={test.id}>
                <button
                  type="button"
                  onClick={() => setSelectedTest(test)}
                  className={`test-history-item ${selectedTest?.id === test.id ? 'test-history-item-active' : ''}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={test.status} />
                    <span className="font-mono text-[10px]">v{test.skillVersion}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {test.provider} / {test.model}
                    </span>
                  </span>
                  <span className="mt-1 block text-left text-[10px] text-muted-foreground">
                    {formatDateTime(test.createdAt)} · {test.durationMs}ms · {test.input.slice(0, 50)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
