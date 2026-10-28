'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Code2,
  Database,
  FileJson,
  LoaderCircle,
  Play,
  Power,
  Save,
  Search,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest, jsonBody } from '@/lib/client';
import type {
  ToolSummary,
  ToolTestResponse,
  ToolsResponse,
} from '@/lib/types';

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="empty-state">
      <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden />
      <p className="text-xs">{label}</p>
    </div>
  );
}

export function ToolsManager() {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [schemaTab, setSchemaTab] = useState<'input' | 'output' | 'example'>('input');
  const [testInput, setTestInput] = useState('{}');
  const [testResult, setTestResult] = useState<ToolTestResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const selected = tools.find((tool) => tool.id === selectedId) ?? null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await apiRequest<ToolsResponse>('/api/tools');
      if (cancelled) return;
      if (!result.ok) {
        setListState('error');
        setError(result.error);
        return;
      }
      setTools(result.data.tools);
      setListState('ready');
      const first = result.data.tools[0];
      if (first) {
        setSelectedId(first.id);
        setEditName(first.name);
        setEditDescription(first.description);
        setTestInput(JSON.stringify(first.sampleInput, null, 2));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredTools = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('zh-CN');
    if (!term) return tools;
    return tools.filter((tool) =>
      [tool.id, tool.name, tool.description, tool.category]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(term),
    );
  }, [query, tools]);

  function selectTool(tool: ToolSummary) {
    setSelectedId(tool.id);
    setEditName(tool.name);
    setEditDescription(tool.description);
    setSchemaTab('input');
    setTestInput(JSON.stringify(tool.sampleInput, null, 2));
    setTestResult(null);
    setTestError(null);
    setConfigOpen(false);
  }

  async function saveMetadata() {
    if (!selected || savingMeta) return;
    if (!editName.trim()) {
      toast.error('工具名称不能为空');
      return;
    }
    if (!editDescription.trim()) {
      toast.error('能力描述不能为空');
      return;
    }
    setSavingMeta(true);
    setError(null);
    const result = await apiRequest<{ tool: ToolSummary }>(
      `/api/tools/${encodeURIComponent(selected.id)}`,
      {
        method: 'PATCH',
        body: jsonBody({
          name: editName.trim(),
          description: editDescription.trim(),
        }),
      },
    );
    setSavingMeta(false);
    if (!result.ok) {
      setError(result.error);
      toast.error('工具配置保存失败', { description: result.error });
      return;
    }
    const next = result.data.tool;
    setTools((current) => current.map((tool) => (tool.id === next.id ? next : tool)));
    setEditName(next.name);
    setEditDescription(next.description);
    toast.success('工具配置已保存', {
      description: 'Planner 与 Executor 会在下一次读取注册表时立即使用新名称和描述。',
    });
  }

  async function toggleTool() {
    if (!selected || toggling) return;
    setToggling(true);
    setError(null);
    const result = await apiRequest<{ tool: ToolSummary }>(
      `/api/tools/${encodeURIComponent(selected.id)}`,
      { method: 'PATCH', body: jsonBody({ enabled: !selected.enabled }) },
    );
    setToggling(false);

    if (!result.ok) {
      setError(result.error);
      toast.error('工具启停失败', { description: result.error });
      return;
    }

    const next = result.data.tool;
    setTools((current) => current.map((tool) => (tool.id === next.id ? next : tool)));
    setTestResult(null);
    setTestError(null);
    toast.success(next.enabled ? '工具已启用' : '工具已停用', {
      description: `${next.name} · ${next.id}`,
    });
  }

  async function runTest() {
    if (!selected || testRunning) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(testInput);
    } catch {
      toast.error('测试输入不是有效 JSON');
      setTestError('测试输入不是有效 JSON，请检查括号、引号和逗号。');
      return;
    }

    setTestRunning(true);
    setTestResult(null);
    setTestError(null);
    const result = await apiRequest<ToolTestResponse>(
      `/api/tools/${encodeURIComponent(selected.id)}/test`,
      { method: 'POST', body: jsonBody(parsed) },
    );
    setTestRunning(false);

    if (!result.ok) {
      setTestError(result.error);
      toast.error('工具测试失败', { description: result.error });
      return;
    }

    setTestResult(result.data);
    toast.success('工具测试通过', {
      description: `${selected.id} 执行完成 · ${result.data.durationMs}ms`,
    });
  }

  const enabledCount = tools.filter((tool) => tool.enabled).length;

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div className="min-w-0">
          <p className="eyebrow">AGENT ASSETS / TOOL REGISTRY</p>
          <h1 className="page-title">Tool 注册中心</h1>
          <p className="page-subtitle">
            配置工具名称与能力描述，查看执行方式、实现位置、数据源和完整只读 JSON，并使用真实业务数据运行单项测试。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{tools.length} 个 Tool</Badge>
          <Badge tone="success">{enabledCount} 个启用</Badge>
          <Badge tone="neutral">只读执行</Badge>
        </div>
      </header>

      {error ? (
        <div role="alert" className="alert alert-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="registry-layout">
        <Card className="registry-list-panel">
          <CardHeader className="gap-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle>工具清单</CardTitle>
              <Badge tone="neutral">{filteredTools.length} / {tools.length}</Badge>
            </div>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索工具名称或 ID"
                aria-label="搜索 Tool"
                className="pl-8"
              />
            </div>
          </CardHeader>

          <CardContent className="px-2 pb-2 pt-3">
            {listState === 'loading' ? (
              <LoadingBlock label="正在加载 Tool 注册表…" />
            ) : listState === 'error' ? (
              <div className="empty-state">
                <AlertCircle className="size-6 text-primary" aria-hidden />
                <p className="text-xs font-medium">工具清单加载失败</p>
                <p className="text-[11px]">请刷新页面后重试。</p>
              </div>
            ) : filteredTools.length === 0 ? (
              <div className="empty-state">
                <Wrench className="size-6" aria-hidden />
                <p className="text-xs font-medium">没有匹配的工具</p>
                <p className="text-[11px]">调整搜索词后再试。</p>
              </div>
            ) : (
              <ul className="asset-list" aria-label="Tool 列表">
                {filteredTools.map((tool) => (
                  <li key={tool.id}>
                    <button
                      type="button"
                      onClick={() => selectTool(tool)}
                      aria-current={selectedId === tool.id ? 'true' : undefined}
                      className={`asset-list-item ${selectedId === tool.id ? 'asset-list-item-active' : ''}`}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-xs font-semibold">{tool.name}</span>
                          {tool.enabled ? (
                            <Badge tone="success">已启用</Badge>
                          ) : (
                            <Badge tone="neutral">已停用</Badge>
                          )}
                        </span>
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {tool.id}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {tool.category} · v{tool.version} · {tool.timeoutMs}ms
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="registry-detail-panel">
          {listState === 'loading' ? (
            <LoadingBlock label="正在加载工具详情…" />
          ) : !selected ? (
            <div className="empty-state">
              <Wrench className="size-6" aria-hidden />
              <p className="text-xs font-medium">选择一个 Tool</p>
              <p className="text-[11px]">从左侧清单进入工具详情，查看 Schema 或运行测试。</p>
            </div>
          ) : (
            <>
              <CardHeader className="gap-3 border-b">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{selected.name}</CardTitle>
                      {selected.enabled ? (
                        <Badge tone="success">已启用</Badge>
                      ) : (
                        <Badge tone="neutral">已停用</Badge>
                      )}
                      <Badge tone="accent">v{selected.version}</Badge>
                    </div>
                    <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                      {selected.id}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfigOpen(true)}
                    >
                      <FileJson aria-hidden />
                      查看完整配置 JSON
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={toggleTool}
                      disabled={toggling}
                    >
                      {toggling ? <LoaderCircle className="animate-spin" aria-hidden /> : <Power aria-hidden />}
                      {selected.enabled ? '停用工具' : '启用工具'}
                    </Button>
                  </div>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{selected.description}</p>
                <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Code2 className="size-3" aria-hidden />
                    {selected.category}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="size-3" aria-hidden />
                    超时 {selected.timeoutMs}ms
                  </span>
                </div>
              </CardHeader>

              <CardContent className="space-y-5 pt-4">
                <section className="tool-meta-panel">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold">工具配置</p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        名称与能力描述会立即进入 Planner 的可用工具清单；执行方式、实现位置和数据源为只读运行事实。
                      </p>
                    </div>
                    <Badge tone="neutral">只读执行 · 不允许写业务数据</Badge>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <label className="field-group">
                      <span className="field-label">工具名称 · 可配置</span>
                      <Input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        maxLength={80}
                      />
                    </label>
                    <label className="field-group">
                      <span className="field-label">执行方式</span>
                      <Input value={selected.executionMode} readOnly disabled />
                    </label>
                    <label className="field-group lg:col-span-2">
                      <span className="field-label">能力描述 · 可配置</span>
                      <Textarea
                        value={editDescription}
                        onChange={(event) => setEditDescription(event.target.value)}
                        maxLength={500}
                        className="min-h-[72px]"
                      />
                    </label>
                    <div className="field-group">
                      <span className="field-label">数据源</span>
                      <div className="readonly-meta">
                        {selected.dataSources.map((source) => (
                          <span key={source} className="inline-flex items-center gap-1">
                            <Database className="size-3" aria-hidden />
                            <code>{source}</code>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="field-group">
                      <span className="field-label">实现位置</span>
                      <code className="field-code">{selected.implementationPath}</code>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] text-muted-foreground">
                      工具 ID <code>{selected.id}</code> 与执行实现不可在此修改。
                    </p>
                    <Button type="button" size="sm" onClick={saveMetadata} disabled={savingMeta}>
                      {savingMeta ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                      {savingMeta ? '保存中…' : '保存工具配置'}
                    </Button>
                  </div>
                </section>

                <section>
                  <div className="registry-tabs registry-tabs-inline" role="tablist" aria-label="Tool Schema">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={schemaTab === 'input'}
                      onClick={() => setSchemaTab('input')}
                      className={schemaTab === 'input' ? 'active' : ''}
                    >
                      输入 Schema
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={schemaTab === 'output'}
                      onClick={() => setSchemaTab('output')}
                      className={schemaTab === 'output' ? 'active' : ''}
                    >
                      输出 Schema
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={schemaTab === 'example'}
                      onClick={() => setSchemaTab('example')}
                      className={schemaTab === 'example' ? 'active' : ''}
                    >
                      输出示例
                    </button>
                  </div>
                  <JsonBlock
                    value={
                      schemaTab === 'input'
                        ? selected.inputSchema
                        : schemaTab === 'output'
                          ? selected.outputSchema
                          : selected.outputExample
                    }
                  />
                </section>

                <section className="tool-test-panel">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold">运行单项测试</p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        测试直接读取当前 data 目录中的真实 JSON；不会创建订单或修改业务数据。
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={runTest}
                      disabled={testRunning || !selected.enabled}
                    >
                      {testRunning ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}
                      {testRunning ? '运行中…' : '运行测试'}
                    </Button>
                  </div>

                  {!selected.enabled ? (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                      工具已停用。启用后才能运行单项测试。
                    </p>
                  ) : null}

                  <label className="field-group mt-4">
                    <span className="field-label">测试输入（JSON）</span>
                    <Textarea
                      value={testInput}
                      onChange={(event) => setTestInput(event.target.value)}
                      className="min-h-[190px] font-mono text-[11px] leading-6"
                      spellCheck={false}
                      disabled={!selected.enabled}
                    />
                  </label>

                  {testRunning ? (
                    <p role="status" className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                      正在调用工具并校验输出 Schema…
                    </p>
                  ) : null}

                  {testError ? (
                    <div role="alert" className="mt-3 alert alert-danger">
                      <AlertCircle className="size-4 shrink-0" aria-hidden />
                      <span>{testError}</span>
                    </div>
                  ) : null}

                  {testResult ? (
                    <div className="mt-4 space-y-3">
                      <p className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-emerald-800">
                        <CheckCircle2 className="size-3.5" aria-hidden />
                        服务端执行成功
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {testResult.toolId} · {testResult.durationMs}ms
                        </span>
                      </p>
                      <div className="grid gap-3 xl:grid-cols-2">
                        <div>
                          <p className="agent-label">真实输入 · 服务端校验后</p>
                          <JsonBlock value={testResult.input} />
                        </div>
                        <div>
                          <p className="agent-label">真实输出 · 服务端返回</p>
                          <JsonBlock value={testResult.output} />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>
              </CardContent>
            </>
          )}
        </Card>
      </div>

      <p className="page-note">
        工具执行入口会重新读取启停配置，并校验输入输出 Zod Schema。Planner / Executor 通过
        <code> GET /api/registry</code> 只读取启用工具。
      </p>

      {configOpen && selected ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfigOpen(false);
          }}
          title="完整配置 JSON"
          description={`${selected.name} · ${selected.id} · 只读`}
          className="max-w-3xl"
        >
          <div className="space-y-3">
            <p className="text-[10px] leading-5 text-muted-foreground">
              包含注册表字段、启停配置、执行元数据、数据源、输入/输出 Schema 和示例输入；此 JSON 不包含可编辑实现。
            </p>
            <JsonBlock value={selected.fullConfig} />
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
