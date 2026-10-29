'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronRight,
  Eye,
  FileText,
  FlaskConical,
  History,
  LoaderCircle,
  Plus,
  Power,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SkillCreateDialog } from '@/components/registry/skill-create-dialog';
import { SkillTestPanel } from '@/components/registry/skill-test-panel';
import {
  apiRequest,
  formatDateTime,
  jsonBody,
} from '@/lib/client';
import type {
  SkillDetail,
  SkillDetailResponse,
  SkillDiffResponse,
  SkillFileResponse,
  SkillSummary,
  SkillUpdatePayload,
  SkillVersionDetail,
  SkillVersionDetailResponse,
  SkillVersionsResponse,
  SkillVersionSummary,
  SkillsResponse,
  ToolSummary,
  ToolsResponse,
} from '@/lib/types';

type FormState = {
  name: string;
  description: string;
  model: string;
  temperature: string;
  maxTokens: string;
  requiredTools: string[];
  systemPrompt: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  model: '',
  temperature: '0.2',
  maxTokens: '1200',
  requiredTools: [],
  systemPrompt: '',
};

function formFrom(skill: SkillDetail): FormState {
  return {
    name: skill.name,
    description: skill.description,
    model: skill.model,
    temperature: String(skill.temperature),
    maxTokens: String(skill.maxTokens),
    requiredTools: [...skill.requiredTools],
    systemPrompt: skill.systemPrompt,
  };
}

function summaryFromDetail(detail: SkillDetail): SkillSummary {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    category: detail.category,
    enabled: detail.enabled,
    model: detail.model,
    temperature: detail.temperature,
    maxTokens: detail.maxTokens,
    requiredTools: detail.requiredTools,
    version: detail.version,
    filePath: detail.filePath,
    updatedAt: detail.updatedAt,
    hash: detail.hash,
    promptLength: detail.promptLength,
  };
}

function updateSummary(list: SkillSummary[], detail: SkillDetail): SkillSummary[] {
  return list.map((item) => (item.id === detail.id ? summaryFromDetail(detail) : item));
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="empty-state">
      <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden />
      <p className="text-xs">{label}</p>
    </div>
  );
}

function EmptyBlock({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <FileText className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-xs font-medium">{title}</p>
      <p className="max-w-sm text-[11px] leading-5">{detail}</p>
    </div>
  );
}

export function SkillsManager() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [versions, setVersions] = useState<SkillVersionSummary[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [detailLoading, setDetailLoading] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [applyVersionId, setApplyVersionId] = useState('');
  const [applyingVersion, setApplyingVersion] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [tab, setTab] = useState<'edit' | 'versions' | 'test'>('edit');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [changeNote, setChangeNote] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<SkillVersionSummary | null>(null);
  const [versionDetail, setVersionDetail] = useState<SkillVersionDetail | null>(null);
  const [diff, setDiff] = useState<SkillDiffResponse | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileContent, setFileContent] = useState<SkillFileResponse | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  const loadVersions = useCallback(async (skillId: string) => {
    setVersionsLoading(true);
    const result = await apiRequest<SkillVersionsResponse>(
      `/api/skills/${encodeURIComponent(skillId)}/versions`,
    );
    setVersionsLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setVersions(result.data.versions);
    setApplyVersionId((current) => {
      if (result.data.versions.some((item) => item.id === current)) return current;
      return (result.data.versions.find((item) => item.status !== '草稿') ?? result.data.versions[0])?.id ?? '';
    });
  }, []);

  const loadSkill = useCallback(
    async (skillId: string) => {
      setDetailLoading(true);
      setError(null);
      setVersionDetail(null);
      setSelectedVersion(null);
      setDiff(null);
      setTab('edit');
      setSaveDialogOpen(false);
      setFileOpen(false);
      const [detailResult, versionsResult] = await Promise.all([
        apiRequest<SkillDetailResponse>(`/api/skills/${encodeURIComponent(skillId)}`),
        apiRequest<SkillVersionsResponse>(
          `/api/skills/${encodeURIComponent(skillId)}/versions`,
        ),
      ]);
      setDetailLoading(false);

      if (!detailResult.ok) {
        setDetail(null);
        setError(detailResult.error);
        return;
      }

      setDetail(detailResult.data.skill);
      setForm(formFrom(detailResult.data.skill));
      if (versionsResult.ok) {
        setVersions(versionsResult.data.versions);
        setApplyVersionId((versionsResult.data.versions.find((item) => item.status !== '草稿') ?? versionsResult.data.versions[0])?.id ?? '');
      } else {
        setVersions([]);
        setError(versionsResult.error);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      setListState('loading');
      const [skillsResult, toolsResult] = await Promise.all([
        apiRequest<SkillsResponse>('/api/skills'),
        apiRequest<ToolsResponse>('/api/tools'),
      ]);
      if (cancelled) return;

      if (!skillsResult.ok) {
        setListState('error');
        setError(skillsResult.error);
        return;
      }

      setSkills(skillsResult.data.skills);
      if (toolsResult.ok) {
        setTools(toolsResult.data.tools);
      } else {
        setError(toolsResult.error);
      }
      setListState('ready');

      const first = skillsResult.data.skills[0];
      if (first) {
        setSelectedId(first.id);
        await loadSkill(first.id);
      }
    }

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [loadSkill]);

  const filteredSkills = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('zh-CN');
    return skills.filter((skill) => {
      if (filter === 'enabled' && !skill.enabled) return false;
      if (filter === 'disabled' && skill.enabled) return false;
      if (!term) return true;
      return [skill.id, skill.name, skill.description, skill.category]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(term);
    });
  }, [filter, query, skills]);

  const enabledCount = skills.filter((skill) => skill.enabled).length;

  function selectSkill(skillId: string) {
    if (skillId === selectedId) return;
    setSelectedId(skillId);
    void loadSkill(skillId);
  }

  async function toggleEnabled() {
    if (!detail || toggling) return;
    setToggling(true);
    setError(null);
    const result = await apiRequest<SkillDetailResponse>(
      `/api/skills/${encodeURIComponent(detail.id)}`,
      {
        method: 'PATCH',
        body: jsonBody({ enabled: !detail.enabled }),
      },
    );
    setToggling(false);

    if (!result.ok) {
      setError(result.error);
      toast.error('启停操作失败', { description: result.error });
      return;
    }

    const next = result.data.skill;
    setDetail(next);
    setForm(formFrom(next));
    setSkills((current) => updateSummary(current, next));
    toast.success(next.enabled ? 'Skill 已启用' : 'Skill 已停用', {
      description: `${next.name} · ${next.id}`,
    });
  }

  function validateSkillForm(): boolean {
    const temperature = Number(form.temperature);
    const maxTokens = Number(form.maxTokens);
    if (!form.name.trim()) {
      toast.error('Skill 名称不能为空');
      return false;
    }
    if (
      detail &&
      skills.some(
        (skill) =>
          skill.id !== detail.id &&
          skill.name.trim().toLocaleLowerCase('zh-CN') ===
            form.name.trim().toLocaleLowerCase('zh-CN'),
      )
    ) {
      toast.error('Skill 名称已被其他 Skill 使用');
      return false;
    }
    if (!form.description.trim()) {
      toast.error('触发描述不能为空');
      return false;
    }
    if (!form.model.trim()) {
      toast.error('模型不能为空');
      return false;
    }
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      toast.error('Temperature 必须在 0–2 之间');
      return false;
    }
    if (!Number.isInteger(maxTokens) || maxTokens < 100 || maxTokens > 32000) {
      toast.error('Max tokens 必须是 100–32000 的整数');
      return false;
    }
    if (form.systemPrompt.trim().length < 20) {
      toast.error('SKILL.md 至少需要 20 个字符');
      return false;
    }
    if (!changeNote.trim()) {
      toast.error('请填写本次版本变更说明');
      return false;
    }
    return true;
  }

  function openSaveDialog() {
    if (!detail || saving) return;
    if (validateSkillForm()) setSaveDialogOpen(true);
  }

  async function saveVersion() {
    if (!detail || saving) return;
    if (!validateSkillForm()) return;
    const temperature = Number(form.temperature);
    const maxTokens = Number(form.maxTokens);

    const payload: SkillUpdatePayload = {
      name: form.name.trim(),
      description: form.description.trim(),
      model: form.model.trim(),
      temperature,
      maxTokens,
      requiredTools: form.requiredTools,
      systemPrompt: form.systemPrompt,
      changeNote: changeNote.trim(),
      expectedHash: detail.hash,
    };

    setSaving(true);
    setError(null);
    const result = await apiRequest<SkillDetailResponse>(
      `/api/skills/${encodeURIComponent(detail.id)}`,
      { method: 'PUT', body: jsonBody(payload) },
    );
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      toast.error('保存新版本失败', { description: result.error });
      if (result.status === 409) {
        void loadSkill(detail.id);
      }
      return;
    }

    const next = result.data.skill;
    setDetail(next);
    setForm(formFrom(next));
    setSkills((current) => updateSummary(current, next));
    setChangeNote('');
    setSaveDialogOpen(false);
    setTab('versions');
    await loadVersions(next.id);
    toast.success(`已保存版本 ${next.version}`, {
      description: '修改前版本已自动保留为快照。',
    });
  }

  async function viewSkillFile() {
    if (!detail || fileLoading) return;
    setFileLoading(true);
    const result = await apiRequest<SkillFileResponse>(
      `/api/skills/${encodeURIComponent(detail.id)}/file`,
    );
    setFileLoading(false);
    if (!result.ok) {
      toast.error('读取 SKILL.md 失败', { description: result.error });
      return;
    }
    setFileContent(result.data);
    setFileOpen(true);
  }

  function handleSkillCreated(skill: SkillDetail) {
    setSkills((current) => {
      const next = current.some((item) => item.id === skill.id)
        ? updateSummary(current, skill)
        : [...current, summaryFromDetail(skill)];
      return next.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    });
    setSelectedId(skill.id);
    setDetail(skill);
    setForm(formFrom(skill));
    setVersions([]);
    setApplyVersionId('');
    setVersionDetail(null);
    setSelectedVersion(null);
    setDiff(null);
    setTab('edit');
    void loadVersions(skill.id);
  }

  async function applySelectedVersion() {
    if (!detail || !applyVersionId || applyingVersion) return;
    const version = versions.find((item) => item.id === applyVersionId);
    if (!version || version.status === '当前' || version.status === '草稿') return;
    setApplyingVersion(true);
    try {
      const result = await apiRequest<SkillDetailResponse>(
        `/api/skills/${encodeURIComponent(detail.id)}/apply-version`,
        { method: 'POST', body: jsonBody({ versionId: applyVersionId }) },
      );
      if (!result.ok) {
        toast.error('应用版本失败', { description: result.error });
        return;
      }
      setDetail(result.data.skill);
      setForm(formFrom(result.data.skill));
      toast.success(`已应用版本 v${result.data.skill.version}`, {
        description: '当前 Skill 已切换到所选版本；旧版本仍保留在版本快照中。',
      });
      await loadVersions(detail.id);
      setTab('versions');
    } finally {
      setApplyingVersion(false);
    }
  }

  async function inspectVersion(version: SkillVersionSummary) {
    if (!detail || versionLoading) return;
    setSelectedVersion(version);
    setVersionDetail(null);
    setDiff(null);
    setVersionLoading(true);
    const [versionResult, diffResult] = await Promise.all([
      apiRequest<SkillVersionDetailResponse>(
        `/api/skills/${encodeURIComponent(detail.id)}/versions/${encodeURIComponent(version.id)}`,
      ),
      apiRequest<SkillDiffResponse>(
        `/api/skills/${encodeURIComponent(detail.id)}/diff?from=${encodeURIComponent(version.id)}&to=current`,
      ),
    ]);
    setVersionLoading(false);

    if (!versionResult.ok) {
      setError(versionResult.error);
      toast.error('版本内容加载失败', { description: versionResult.error });
      return;
    }
    setVersionDetail(versionResult.data.version);

    if (!diffResult.ok) {
      setError(diffResult.error);
      toast.error('版本 diff 加载失败', { description: diffResult.error });
    } else {
      setDiff(diffResult.data);
    }
  }

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div className="min-w-0">
          <p className="eyebrow">AGENT ASSETS / SKILL REGISTRY</p>
          <h1 className="page-title">Skill 注册中心</h1>
          <p className="page-subtitle">
            查看当前启用的业务技能，编辑提示词与运行参数。每次保存都会写入不可变版本快照，并保留修改前内容。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{skills.length} 个 Skill</Badge>
          <Badge tone="success">{enabledCount} 个启用</Badge>
          <Badge tone="neutral">{tools.length} 个工具依赖</Badge>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden />
            新增 Skill
          </Button>
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
              <CardTitle>技能清单</CardTitle>
              <Badge tone="neutral">{filteredSkills.length} / {skills.length}</Badge>
            </div>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称、ID 或分类"
                aria-label="搜索 Skill"
                className="pl-8"
              />
            </div>
            <select
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as 'all' | 'enabled' | 'disabled')
              }
              aria-label="按启用状态筛选 Skill"
              className="field-select"
            >
              <option value="all">全部状态</option>
              <option value="enabled">仅已启用</option>
              <option value="disabled">仅已停用</option>
            </select>
          </CardHeader>

          <CardContent className="px-2 pb-2 pt-3">
            {listState === 'loading' ? (
              <LoadingBlock label="正在加载 Skill 注册表…" />
            ) : listState === 'error' ? (
              <EmptyBlock title="Skill 清单加载失败" detail="请检查服务端日志，或刷新页面重试。" />
            ) : filteredSkills.length === 0 ? (
              <EmptyBlock
                title="没有匹配的 Skill"
                detail="调整搜索词或状态筛选后再试。"
              />
            ) : (
              <ul className="asset-list" aria-label="Skill 列表">
                {filteredSkills.map((skill) => (
                  <li key={skill.id}>
                    <button
                      type="button"
                      onClick={() => selectSkill(skill.id)}
                      aria-current={selectedId === skill.id ? 'true' : undefined}
                      className={`asset-list-item ${selectedId === skill.id ? 'asset-list-item-active' : ''}`}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-xs font-semibold">{skill.name}</span>
                          {skill.enabled ? (
                            <Badge tone="success">已启用</Badge>
                          ) : (
                            <Badge tone="neutral">已停用</Badge>
                          )}
                        </span>
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {skill.id}
                        </span>
                        <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{skill.category}</span>
                          <span aria-hidden>·</span>
                          <span>v{skill.version}</span>
                          <span aria-hidden>·</span>
                          <span>{skill.requiredTools.length} 个依赖</span>
                        </span>
                      </span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="registry-detail-panel">
          {detailLoading ? (
            <LoadingBlock label="正在加载 Skill 详情…" />
          ) : !detail ? (
            <EmptyBlock
              title="选择一个 Skill"
              detail="从左侧清单进入技能详情，编辑配置或查看版本快照。"
            />
          ) : (
            <>
              <CardHeader className="gap-3 border-b">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{detail.name}</CardTitle>
                      {detail.enabled ? (
                        <Badge tone="success">已启用</Badge>
                      ) : (
                        <Badge tone="neutral">已停用</Badge>
                      )}
                      <Badge tone="accent">v{detail.version}</Badge>
                    </div>
                    <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                      {detail.id} · {detail.filePath}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={viewSkillFile}
                      disabled={fileLoading}
                    >
                      {fileLoading ? (
                        <LoaderCircle className="animate-spin" aria-hidden />
                      ) : (
                        <Eye aria-hidden />
                      )}
                      查看 SKILL.md
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={toggleEnabled}
                      disabled={toggling}
                    >
                      {toggling ? (
                        <LoaderCircle className="animate-spin" aria-hidden />
                      ) : (
                        <Power aria-hidden />
                      )}
                      {detail.enabled ? '停用技能' : '启用技能'}
                    </Button>
                    {tab === 'edit' ? (
                      <Button type="button" size="sm" onClick={openSaveDialog} disabled={saving}>
                        {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                        {saving ? '保存中…' : '保存版本快照'}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="size-3" aria-hidden />
                    hash {detail.hash.slice(0, 12)}…{detail.hash.slice(-6)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <History className="size-3" aria-hidden />
                    更新于 {formatDateTime(detail.updatedAt)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="size-3" aria-hidden />
                    {detail.model}
                  </span>
                </div>
              </CardHeader>

              <div className="registry-tabs" role="tablist" aria-label="Skill 详情视图">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'edit'}
                  onClick={() => setTab('edit')}
                  className={tab === 'edit' ? 'active' : ''}
                >
                  <FileText className="size-3.5" aria-hidden />
                  配置与提示词
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'versions'}
                  onClick={() => setTab('versions')}
                  className={tab === 'versions' ? 'active' : ''}
                >
                  <History className="size-3.5" aria-hidden />
                  版本与 diff
                  <span className="registry-tab-count">{versions.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'test'}
                  onClick={() => setTab('test')}
                  className={tab === 'test' ? 'active' : ''}
                >
                  <FlaskConical className="size-3.5" aria-hidden />
                  单项测试
                </button>
              </div>

              <CardContent className="pt-4">
                {tab === 'edit' ? (
                  <div className="registry-form">
                    <div className="form-grid">
                      <label className="field-group">
                        <span className="field-label">Skill 名称 · Planner 可见</span>
                        <Input
                          value={form.name}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, name: event.target.value }))
                          }
                          maxLength={80}
                        />
                      </label>
                      <div className="field-group">
                        <span className="field-label">SKILL.md 文件路径</span>
                        <code className="field-code">{detail.filePath}</code>
                      </div>
                      <label className="field-group col-span-2">
                        <span className="field-label">触发描述 · Planner 读取</span>
                        <Input
                          value={form.description}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, description: event.target.value }))
                          }
                          maxLength={500}
                        />
                      </label>
                      <label className="field-group">
                        <span className="field-label">模型</span>
                        <Input
                          value={form.model}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, model: event.target.value }))
                          }
                          maxLength={120}
                        />
                      </label>
                      <label className="field-group">
                        <span className="field-label">Temperature · 0–2</span>
                        <Input
                          type="number"
                          min={0}
                          max={2}
                          step={0.05}
                          value={form.temperature}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, temperature: event.target.value }))
                          }
                        />
                      </label>
                      <label className="field-group">
                        <span className="field-label">Max tokens</span>
                        <Input
                          type="number"
                          min={100}
                          max={32000}
                          step={100}
                          value={form.maxTokens}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, maxTokens: event.target.value }))
                          }
                        />
                      </label>
                    </div>

                    <fieldset className="field-group">
                      <legend className="field-label">依赖工具</legend>
                      <div className="tool-check-grid">
                        {tools.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">工具清单暂不可用。</p>
                        ) : (
                          tools.map((tool) => {
                            const checked = form.requiredTools.includes(tool.id);
                            return (
                              <label key={tool.id} className="tool-check">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setForm((current) => ({
                                      ...current,
                                      requiredTools: checked
                                        ? current.requiredTools.filter((item) => item !== tool.id)
                                        : [...current.requiredTools, tool.id],
                                    }))
                                  }
                                />
                                <span className="min-w-0">
                                  <span className="block truncate text-xs">{tool.name}</span>
                                  <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                                    {tool.id}
                                    {!tool.enabled ? ' · 已停用' : ''}
                                  </span>
                                </span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </fieldset>

                    <label className="field-group">
                      <span className="field-label">System prompt</span>
                      <Textarea
                        value={form.systemPrompt}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, systemPrompt: event.target.value }))
                        }
                        className="min-h-[360px] font-mono text-[11px] leading-6"
                        maxLength={50000}
                        spellCheck={false}
                      />
                      <span className="field-hint">
                        {form.systemPrompt.length.toLocaleString('zh-CN')} 字符 · 只接受服务端生成的安全文件路径
                      </span>
                    </label>

                    <div className="save-bar">
                      <label className="field-group min-w-0 flex-1">
                        <span className="field-label">本次变更说明 · 必填</span>
                        <Input
                          value={changeNote}
                          onChange={(event) => setChangeNote(event.target.value)}
                          placeholder="例如：补充过敏原判断中的可能含有信息"
                          maxLength={500}
                        />
                      </label>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Button type="button" onClick={openSaveDialog} disabled={saving}>
                          {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                          {saving ? '保存中…' : '保存版本快照'}
                        </Button>
                        <span className="text-[10px] text-muted-foreground">
                          将保存为 v{detail.nextVersion}，旧版本自动快照
                        </span>
                      </div>
                    </div>
                  </div>
                ) : tab === 'versions' ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                      <label className="min-w-[220px] text-[10px] text-muted-foreground">选择应用版本
                        <select className="field-select mt-1" value={applyVersionId} onChange={(event) => setApplyVersionId(event.target.value)} disabled={versionsLoading || applyingVersion}>
                          {versions.map((version) => <option key={version.id} value={version.id} disabled={version.status === '当前' || version.status === '草稿'}>v{version.version} · {version.status}{version.version === versions[0]?.version ? ' · 最新' : ''}</option>)}
                        </select>
                      </label>
                      <Button type="button" size="sm" onClick={() => void applySelectedVersion()} disabled={applyingVersion || !applyVersionId || versions.find((item) => item.id === applyVersionId)?.status === '当前' || versions.find((item) => item.id === applyVersionId)?.status === '草稿'}>
                        {applyingVersion ? <LoaderCircle className="animate-spin" aria-hidden /> : <History aria-hidden />}
                        {applyingVersion ? '应用中…' : '应用此版本'}
                      </Button>
                      <span className="mb-1 text-[10px] text-muted-foreground">默认应用最新可用版本；应用后旧版本仍保留，不会生成新版本号。</span>
                    </div>
                  <div className="version-layout">
                    <div className="version-list-wrap">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold">版本快照</p>
                        {versionsLoading ? (
                          <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
                        ) : null}
                      </div>
                      {versionsLoading ? (
                        <LoadingBlock label="正在加载版本…" />
                      ) : versions.length === 0 ? (
                        <EmptyBlock
                          title="还没有版本快照"
                          detail="保存一次修改后，系统会自动保留修改前版本并生成当前版本快照。"
                        />
                      ) : (
                        <ul className="version-list" aria-label="版本列表">
                          {versions.map((version) => (
                            <li key={version.id}>
                              <button
                                type="button"
                                onClick={() => void inspectVersion(version)}
                                className={`version-item ${selectedVersion?.id === version.id ? 'version-item-active' : ''}`}
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-[11px] font-semibold">v{version.version}</span>
                                  {version.status === '当前' ? (
                                    <Badge tone="success">当前</Badge>
                                  ) : version.status === '草稿' ? (
                                    <Badge tone="warning">草稿</Badge>
                                  ) : (
                                    <Badge tone="neutral">历史</Badge>
                                  )}
                                </span>
                                <span className="mt-1 block line-clamp-2 text-left text-[10px] leading-4 text-muted-foreground">
                                  {version.changeNote}
                                </span>
                                <span className="mt-1 block text-left text-[9px] text-muted-foreground">
                                  {formatDateTime(version.createdAt)} · {version.createdBy}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="version-detail-wrap">
                      {!selectedVersion ? (
                        <EmptyBlock
                          title="选择一个版本查看内容"
                          detail="点击左侧版本，可以查看完整提示词、变更说明，以及与当前版本的逐行 diff。"
                        />
                      ) : versionLoading ? (
                        <LoadingBlock label="正在读取版本内容并生成 diff…" />
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="flex items-center gap-2 text-xs font-semibold">
                                v{selectedVersion.version}
                                {selectedVersion.status === '当前' ? (
                                  <Badge tone="success">当前版本</Badge>
                                ) : selectedVersion.status === '草稿' ? (
                                  <Badge tone="warning">草稿版本</Badge>
                                ) : (
                                  <Badge tone="neutral">历史版本</Badge>
                                )}
                              </p>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                {selectedVersion.changeNote} · {formatDateTime(selectedVersion.createdAt)}
                              </p>
                            </div>
                            {diff ? (
                              <div className="flex gap-1.5">
                                <Badge tone="success">+{diff.stats.added} 行</Badge>
                                <Badge tone="danger">−{diff.stats.removed} 行</Badge>
                              </div>
                            ) : null}
                          </div>

                          {versionDetail ? (
                            <div className="version-content">
                              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                                <FileText className="size-3" aria-hidden />
                                版本正文
                              </p>
                              <pre>{versionDetail.systemPrompt}</pre>
                            </div>
                          ) : null}

                          <div className="version-diff">
                            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                              <History className="size-3" aria-hidden />
                              与当前版本逐行对比
                            </p>
                            {diff ? (
                              <div className="diff-block" aria-label="版本 diff">
                                {diff.lines.map((line, index) => (
                                  <div
                                    key={`${line.type}-${index}-${line.oldLine ?? 0}-${line.newLine ?? 0}`}
                                    className={`diff-line diff-${line.type}`}
                                  >
                                    <span className="diff-line-no">{line.oldLine ?? ''}</span>
                                    <span className="diff-line-no">{line.newLine ?? ''}</span>
                                    <span className="diff-marker">
                                      {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                                    </span>
                                    <span className="diff-text">{line.text || ' '}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-muted-foreground">diff 暂不可用。</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  </div>
                ) : (
                  <SkillTestPanel key={detail.id} skill={detail} />
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>

      <p className="page-note">
        Planner / Executor 通过 <code>GET /api/registry</code> 读取当前启用的 Skill 与 Tool。保存操作只接受 Skill ID
        和服务端计算的文件路径，不接收客户端传入的任意文件路径。
      </p>

      {createOpen ? (
        <SkillCreateDialog
          tools={tools}
          existingSkills={skills}
          onClose={() => setCreateOpen(false)}
          onCreated={handleSkillCreated}
        />
      ) : null}

      {fileOpen && detail ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setFileOpen(false);
          }}
          title="SKILL.md 原文"
          description={`${detail.name} · ${fileContent?.filePath ?? detail.filePath}`}
          className="max-w-3xl"
        >
          <div className="space-y-3">
            <p className="text-[10px] text-muted-foreground">
              这是当前生效文件的原文，只读。hash {fileContent?.hash.slice(0, 16) ?? detail.hash.slice(0, 16)}…
            </p>
            <pre className="json-block max-h-[60vh] overflow-auto whitespace-pre-wrap">
              {fileContent?.content ?? '加载中…'}
            </pre>
          </div>
        </Dialog>
      ) : null}

      {saveDialogOpen && detail ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !saving) setSaveDialogOpen(false);
          }}
          title="保存版本快照"
          description="确认以下完整内容。保存时会把当前版本自动保留为历史快照，并写入新的当前版本。"
          className="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
              修改前版本 v{detail.version} 会自动保留；新版本为 v{detail.nextVersion}。保存后版本 diff 可查看。
            </div>

            <div className="grid gap-2 text-[11px] sm:grid-cols-2">
              <p><span className="text-muted-foreground">Skill ID：</span><code>{detail.id}</code></p>
              <p><span className="text-muted-foreground">名称：</span>{form.name}</p>
              <p className="sm:col-span-2"><span className="text-muted-foreground">触发描述：</span>{form.description}</p>
              <p><span className="text-muted-foreground">模型：</span>{form.model}</p>
              <p><span className="text-muted-foreground">Temperature：</span>{form.temperature}</p>
              <p><span className="text-muted-foreground">最大输出 Tokens：</span>{form.maxTokens}</p>
              <p><span className="text-muted-foreground">依赖工具：</span>{form.requiredTools.join('、') || '无'}</p>
              <p className="sm:col-span-2 break-all"><span className="text-muted-foreground">文件路径：</span><code>{detail.filePath}</code></p>
            </div>

            <label className="field-group">
              <span className="field-label">本次变更说明 · 必填</span>
              <Input
                value={changeNote}
                onChange={(event) => setChangeNote(event.target.value)}
                maxLength={500}
                placeholder="说明本次保存的目的"
              />
            </label>

            <div>
              <p className="field-label">将写入 SKILL.md 的内容</p>
              <pre className="json-block max-h-64 overflow-auto whitespace-pre-wrap">
                {form.systemPrompt}
              </pre>
            </div>

            {error ? (
              <div role="alert" className="alert alert-danger">
                <AlertCircle className="size-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSaveDialogOpen(false)}
                disabled={saving}
              >
                取消
              </Button>
              <Button type="button" onClick={saveVersion} disabled={saving}>
                {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                {saving ? '保存中…' : `确认保存 v${detail.nextVersion}`}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
