'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  TestTubeDiagonal,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiRequest, formatDateTime, jsonBody } from '@/lib/client';
import type {
  LlmConfigView,
  LlmProviderView,
  LlmTestResponse,
  AgentProviderId,
} from '@/lib/types';

function modeTone(mode: LlmConfigView['mode']): 'success' | 'accent' | 'danger' {
  if (mode === 'real') return 'success';
  if (mode === 'demo') return 'accent';
  return 'danger';
}

function modeLabel(mode: LlmConfigView['mode']): string {
  if (mode === 'real') return '真实 Provider';
  if (mode === 'demo') return '课堂演示稳定模式';
  return '配置异常';
}

function ProviderCard({
  provider,
  data,
  selectedModel,
  onSelectModel,
  onTest,
  onSwitch,
  onSaveModel,
  busy,
}: {
  provider: LlmProviderView;
  data: LlmConfigView;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  onTest: () => void;
  onSwitch: () => void;
  onSaveModel: () => void;
  busy: boolean;
}) {
  const isCurrent = data.current.provider === provider.id;
  return (
    <Card className={`model-provider-card ${isCurrent ? 'model-provider-current' : ''}`}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <Cpu className="size-4 text-primary" aria-hidden />
              {provider.label}
              {isCurrent ? <Badge tone="success">当前</Badge> : null}
              {provider.isDemo ? <Badge tone="accent">演示稳定模式</Badge> : null}
            </CardTitle>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {provider.id} · {provider.configured ? '配置就绪' : '配置缺失'}
            </p>
          </div>
          <Badge tone={provider.configured ? 'success' : 'danger'}>
            {provider.configured ? '可切换' : '缺少配置'}
          </Badge>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">{provider.description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field-group">
            <span className="field-label">默认模型</span>
            <select
              className="field-select"
              value={selectedModel}
              onChange={(event) => onSelectModel(event.target.value)}
              disabled={busy}
              aria-label={`${provider.label} 模型`}
            >
              {provider.models.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            <span className="field-hint">模型列表包含当前默认、环境变量模型与建议项。</span>
          </label>
          <div className="field-group">
            <span className="field-label">Provider 默认模型</span>
            <code className="field-code">{provider.defaultModel}</code>
          </div>
        </div>

        <div>
          <p className="agent-label flex items-center gap-1.5">
            <KeyRound className="size-3" aria-hidden />
            环境变量配置状态
          </p>
          {provider.env.length === 0 ? (
            <p className="mt-1 text-[10px] text-muted-foreground">课堂 fixture 不需要外部环境变量。</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {provider.env.map((item) => (
                <li key={item.key} className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  {item.configured ? (
                    <CheckCircle2 className="size-3 text-emerald-700" aria-hidden />
                  ) : (
                    <XCircle className="size-3 text-red-700" aria-hidden />
                  )}
                  <code className="font-mono">{item.key}</code>
                  {item.required ? <Badge tone="neutral">必需</Badge> : null}
                  <span className="text-muted-foreground">{item.configured ? '已配置' : '未配置'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            只展示配置状态，不读取或回显密钥原文。
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onTest} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <TestTubeDiagonal aria-hidden />}
            测试连接
          </Button>
          {isCurrent ? (
            <Button type="button" variant="outline" size="sm" onClick={onSaveModel} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              保存默认模型
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={onSwitch} disabled={busy || !provider.configured}>
              <RefreshCw aria-hidden />
              切换到此 Provider
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ModelsManager() {
  const [data, setData] = useState<LlmConfigView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ code?: string; message: string } | null>(null);
  const [testResult, setTestResult] = useState<LlmTestResponse | null>(null);
  const [testing, setTesting] = useState<AgentProviderId | null>(null);
  const [switching, setSwitching] = useState<AgentProviderId | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});

  const applyData = useCallback((next: LlmConfigView) => {
    setData(next);
    setSelectedModels((current) => {
      const models: Record<string, string> = {};
      for (const provider of next.providers) {
        models[provider.id] =
          next.current.provider === provider.id && next.current.model
            ? next.current.model
            : current[provider.id] ?? provider.defaultModel;
      }
      return models;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiRequest<LlmConfigView>('/api/llm-config');
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    applyData(result.data);
  }, [applyData]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      const result = await apiRequest<LlmConfigView>('/api/llm-config');
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      applyData(result.data);
    }

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [applyData]);

  const providers = data?.providers ?? [];
  const currentLabel = data ? `${data.current.provider} / ${data.current.model}` : '加载中';

  async function testProvider(provider: LlmProviderView) {
    if (!data || testing) return;
    setTesting(provider.id);
    setActionError(null);
    setTestResult(null);
    const result = await apiRequest<LlmTestResponse>('/api/llm-config/test', {
      method: 'POST',
      body: jsonBody({
        provider: provider.id,
        model: selectedModels[provider.id] ?? provider.defaultModel,
      }),
    });
    setTesting(null);
    if (!result.ok) {
      setActionError({ code: result.code, message: result.error });
      toast.error('连接测试失败', { description: result.error });
      return;
    }
    setTestResult(result.data);
    toast.success('连接测试成功', {
      description: `${result.data.provider} / ${result.data.model} · ${result.data.durationMs}ms`,
    });
  }

  async function switchProvider(provider: LlmProviderView) {
    if (!data || switching) return;
    setSwitching(provider.id);
    setActionError(null);
    setTestResult(null);
    const result = await apiRequest<LlmConfigView>('/api/llm-config/switch', {
      method: 'POST',
      body: jsonBody({
        provider: provider.id,
        model: selectedModels[provider.id] ?? provider.defaultModel,
      }),
    });
    setSwitching(null);
    if (!result.ok) {
      setActionError({ code: result.code, message: result.error });
      toast.error('Provider 切换失败', { description: result.error });
      return;
    }
    applyData(result.data);
    toast.success('Provider 已切换', {
      description: `${result.data.current.provider} / ${result.data.current.model}；后续未显式覆盖的 Run 会使用此配置。`,
    });
  }

  async function saveCurrentModel() {
    if (!data || savingModel) return;
    const provider = data.current.provider;
    setSavingModel(true);
    setActionError(null);
    const result = await apiRequest<LlmConfigView>('/api/llm-config', {
      method: 'PUT',
      body: jsonBody({ model: selectedModels[provider] ?? data.current.model }),
    });
    setSavingModel(false);
    if (!result.ok) {
      setActionError({ code: result.code, message: result.error });
      toast.error('默认模型保存失败', { description: result.error });
      return;
    }
    applyData(result.data);
    toast.success('默认模型已保存', {
      description: `${result.data.current.provider} / ${result.data.current.model}`,
    });
  }

  const busy = testing !== null || switching !== null || savingModel;

  if (loading) {
    return (
      <div className="page-stack">
        <div className="empty-state min-h-[420px]">
          <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden />
          <p className="text-xs">正在读取 Provider 与模型配置…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page-stack">
        <div className="empty-state min-h-[420px]">
          <AlertCircle className="size-6 text-primary" aria-hidden />
          <p className="text-xs font-medium">模型管理加载失败</p>
          <p className="max-w-md text-[11px] leading-5">{error ?? '没有返回配置'}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw aria-hidden />
            重新加载
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div className="min-w-0">
          <p className="eyebrow">CONFIG / MODEL PROVIDER</p>
          <h1 className="page-title">模型管理</h1>
          <p className="page-subtitle">
            管理当前运行 Provider、默认模型与连接测试。切换会写入服务端；后续未显式覆盖的 Agent Run 会使用此配置。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={modeTone(data.mode)}>{modeLabel(data.mode)}</Badge>
          <Badge tone="neutral">{data.current.source}</Badge>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw aria-hidden />
            刷新
          </Button>
        </div>
      </header>

      <div className={`model-mode-banner model-mode-${data.mode}`}>
        <div className="flex items-start gap-2">
          {data.mode === 'error' ? (
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : data.mode === 'demo' ? (
            <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold">{modeLabel(data.mode)}</p>
            <p className="mt-1 text-[11px] leading-5">{data.banner}</p>
            <p className="mt-1 font-mono text-[10px] opacity-80">
              当前：{currentLabel} · 管理状态：{data.config.managed ? '已固定 Provider' : '自动选择'}
            </p>
          </div>
        </div>
      </div>

      {actionError ? (
        <div role="alert" className="alert alert-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>
            {actionError.code ? <code className="mr-2">{actionError.code}</code> : null}
            {actionError.message}
          </span>
        </div>
      ) : null}

      {testResult ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-900">
            <CheckCircle2 className="size-4" aria-hidden />
            连接测试成功
            <Badge tone="success">{testResult.isDemo ? '课堂演示' : '真实 Provider'}</Badge>
          </p>
          <p className="mt-1 text-[11px] text-emerald-900">
            {testResult.provider} / {testResult.model} · {testResult.durationMs}ms · {testResult.message}
          </p>
        </div>
      ) : null}

      <div className="model-current-summary">
        <div>
          <p className="agent-label">当前 Provider</p>
          <p className="mt-1 font-mono text-sm font-semibold">{data.current.provider}</p>
        </div>
        <div>
          <p className="agent-label">当前默认模型</p>
          <p className="mt-1 font-mono text-sm font-semibold">{data.current.model}</p>
        </div>
        <div>
          <p className="agent-label">配置来源</p>
          <p className="mt-1 text-xs">{data.current.source}</p>
        </div>
        <div>
          <p className="agent-label">更新时间</p>
          <p className="mt-1 text-xs">{formatDateTime(data.config.updatedAt)}</p>
        </div>
      </div>

      {providers.length === 0 ? (
        <div className="empty-state">
          <Cpu className="size-6" aria-hidden />
          <p className="text-xs">没有可用的 Provider 配置</p>
          <p className="text-[11px]">请检查服务端环境变量与 llm-config.json。</p>
        </div>
      ) : (
        <div className="model-provider-grid">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              data={data}
              selectedModel={selectedModels[provider.id] ?? provider.defaultModel}
              onSelectModel={(model) =>
                setSelectedModels((current) => ({ ...current, [provider.id]: model }))
              }
              onTest={() => void testProvider(provider)}
              onSwitch={() => void switchProvider(provider)}
              onSaveModel={() => void saveCurrentModel()}
              busy={busy}
            />
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">当前持久化配置</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="json-block">{JSON.stringify(data.config, null, 2)}</pre>
          <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
            该 JSON 只包含 Provider、模型和运行参数，不包含任何密钥原文。
          </p>
        </CardContent>
      </Card>

      <p className="page-note">
        真实 Provider 需要对应环境变量；缺少配置时测试与切换会返回结构化错误，不会回退到课堂演示。密钥只在服务端读取，页面只显示是否配置。
      </p>
    </div>
  );
}
