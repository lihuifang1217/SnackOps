'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Layers3,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Workflow,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest, formatDateTime, jsonBody } from '@/lib/client';
import { PlanCapabilityTimeline, PlanProcessTimeline } from '@/components/agent/plan-timeline';
import type {
  PlannerOverviewResponse,
  PlannerPreviewResponse,
  SkillSummary,
  ToolSummary,
} from '@/lib/types';

const DEFAULT_QUESTION = '我买 3 份每日混合坚果，叠加满 99 减 20 和 SNACK20 优惠券，最后多少钱？';

function SkillCheckItem({
  skill,
  checked,
  onToggle,
}: {
  skill: SkillSummary;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`planner-capability-item ${skill.enabled ? '' : 'planner-capability-disabled'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!skill.enabled}
        onChange={onToggle}
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[11px] font-medium">{skill.name}</span>
          {!skill.enabled ? <Badge tone="neutral">停用</Badge> : null}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
          skill:{skill.id} · {skill.requiredTools.length} 个依赖
        </span>
      </span>
    </label>
  );
}

function ToolCheckItem({
  tool,
  checked,
  onToggle,
  unavailableReason,
}: {
  tool: ToolSummary;
  checked: boolean;
  onToggle: () => void;
  unavailableReason?: string;
}) {
  const disabled = !tool.enabled || Boolean(unavailableReason);
  return (
    <label className={`planner-capability-item ${disabled ? 'planner-capability-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[11px] font-medium">{tool.name}</span>
          {!tool.enabled ? <Badge tone="neutral">停用</Badge> : null}
          {unavailableReason ? <Badge tone="neutral">{unavailableReason}</Badge> : null}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
          tool:{tool.id} · {tool.category}
        </span>
      </span>
    </label>
  );
}

function ValidationBlock({ preview }: { preview: PlannerPreviewResponse }) {
  const { validation } = preview;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="agent-section-title">独立校验</p>
        <Badge tone={validation.valid ? 'success' : 'danger'}>
          {validation.valid ? '校验通过' : '计划被拦截'}
        </Badge>
      </div>
      {preview.parseError ? (
        <div role="alert" className="alert alert-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>{preview.parseError}</span>
        </div>
      ) : null}
      {validation.errors.length > 0 ? (
        <ul className="space-y-1.5">
          {validation.errors.map((issue) => (
            <li key={`${issue.code}-${issue.message}`} className="planner-issue planner-issue-error">
              <span className="font-mono">{issue.code}</span>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {validation.warnings.length > 0 ? (
        <ul className="space-y-1.5">
          {validation.warnings.map((issue) => (
            <li key={`${issue.code}-${issue.message}`} className="planner-issue planner-issue-warning">
              <span className="font-mono">{issue.code}</span>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {validation.errors.length === 0 && validation.warnings.length === 0 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-emerald-800">
          <CheckCircle2 className="size-3.5" aria-hidden />
          没有发现能力、场景或风险遗漏。
        </p>
      ) : null}
    </div>
  );
}

function PreviewBlock({ preview }: { preview: PlannerPreviewResponse }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="agent-section-title">计划预览</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {preview.provider} / {preview.model} · {preview.durationMs}ms · {formatDateTime(preview.generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {preview.isDemo ? <Badge tone="accent">课堂演示</Badge> : <Badge tone="success">真实 Provider</Badge>}
          <Badge tone="neutral">{preview.plannerVersion}</Badge>
        </div>
      </div>

      <PlanProcessTimeline
        plan={preview.plan}
        validation={preview.validation}
        mandatoryCapabilities={preview.mandatoryCapabilities}
        availableSkillsCount={preview.availableSkills.length}
        availableToolsCount={preview.availableTools.length}
      />
      <PlanCapabilityTimeline
        plan={preview.plan}
        mandatoryCapabilities={preview.mandatoryCapabilities}
      />

      <div className="planner-plan-grid">
        <div>
          <p className="agent-label">goal</p>
          <p className="mt-1 text-[11px] leading-5">{preview.plan.goal}</p>
        </div>
        <div>
          <p className="agent-label">risk</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={preview.plan.risk.level === 'high' ? 'danger' : preview.plan.risk.level === 'medium' ? 'warning' : 'success'}>
              {preview.plan.risk.level}
            </Badge>
            {preview.plan.risk.requiresHumanHandoff ? <Badge tone="warning">需要人工接管</Badge> : null}
            {preview.plan.risk.flags.map((flag) => (
              <Badge key={flag} tone="neutral">{flag}</Badge>
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className="agent-label">reasoning</p>
        <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-foreground/80">
          {preview.plan.reasoning || 'Planner 未提供 reasoning。'}
        </p>
      </div>

      <details>
        <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground">
          查看 Plan JSON
        </summary>
        <pre className="json-block mt-2">{JSON.stringify(preview.plan, null, 2)}</pre>
      </details>

      <div>
        <p className="agent-label">实际强制能力（场景 + 手工）</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {preview.mandatoryCapabilities.length === 0 ? (
            <span className="text-[10px] text-muted-foreground">无</span>
          ) : (
            preview.mandatoryCapabilities.map((capability) => (
              <Badge key={capability} tone="neutral">{capability}</Badge>
            ))
          )}
        </div>
      </div>

      <div className="grid gap-2 rounded-md border bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground sm:grid-cols-2">
        <p>确定性场景：<span className="font-mono text-foreground/80">{preview.signals.scenario}</span></p>
        <p>风险等级：<span className="font-mono text-foreground/80">{preview.signals.riskLevel}</span></p>
        <p className="sm:col-span-2">
          预览可用：{preview.availableSkills.length} 个 Skill / {preview.availableTools.length} 个 Tool
        </p>
      </div>

      <ValidationBlock preview={preview} />

      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-5 text-amber-900">
        这是计划预览，不会创建 RunRecord，也不会执行 Skill 或 Tool。正式执行仍会经过完整 Executor 与风险链路。
      </p>
    </div>
  );
}

export function PlannerManager() {
  const [overview, setOverview] = useState<PlannerOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [mandatory, setMandatory] = useState<string[]>([]);
  const [mandatoryPick, setMandatoryPick] = useState('');
  const [customMandatory, setCustomMandatory] = useState('');
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PlannerPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [model, setModel] = useState('provider-default');
  const [temperature, setTemperature] = useState('0.1');
  const [maxTokens, setMaxTokens] = useState('1800');
  const [requiredSkills, setRequiredSkills] = useState<string[]>([]);
  const [baseTools, setBaseTools] = useState<string[]>([]);
  const [priceTools, setPriceTools] = useState<string[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');

  const applyOverview = useCallback((data: PlannerOverviewResponse) => {
    setOverview(data);
    setModel(data.config.model);
    setTemperature(String(data.config.temperature));
    setMaxTokens(String(data.config.maxTokens));
    setSystemPrompt(data.config.systemPrompt);
    setRequiredSkills([...new Set([...data.config.requiredSkills, 'risk-check'])]);
    setBaseTools(data.config.baseTools);
    setPriceTools(data.config.priceTools);
    const allowedToolIds = new Set([...data.config.baseTools, ...data.config.priceTools]);
    setSelectedSkillIds(data.skills.filter((skill) => skill.enabled).map((skill) => skill.id));
    setSelectedToolIds(
      data.tools.filter((tool) => tool.enabled && allowedToolIds.has(tool.id)).map((tool) => tool.id),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiRequest<PlannerOverviewResponse>('/api/planner');
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    applyOverview(result.data);
  }, [applyOverview]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      const result = await apiRequest<PlannerOverviewResponse>('/api/planner');
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      applyOverview(result.data);
    }

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [applyOverview]);

  const enabledSkills = useMemo(
    () => overview?.skills.filter((skill) => skill.enabled) ?? [],
    [overview],
  );
  const enabledTools = useMemo(
    () => overview?.tools.filter((tool) => tool.enabled) ?? [],
    [overview],
  );
  const allowedToolIds = useMemo(
    () => new Set([...baseTools, ...priceTools]),
    [baseTools, priceTools],
  );
  const mandatoryOptions = useMemo(
    () => [
      ...enabledSkills.map((skill) => ({ value: `skill:${skill.id}`, label: `${skill.name} (skill)` })),
      ...enabledTools.map((tool) => ({ value: `tool:${tool.id}`, label: `${tool.name} (tool)` })),
    ],
    [enabledSkills, enabledTools],
  );
  const allowedEnabledTools = enabledTools.filter((tool) => allowedToolIds.has(tool.id));
  const allSelected =
    enabledSkills.length > 0 &&
    selectedSkillIds.length === enabledSkills.length &&
    selectedToolIds.length === allowedEnabledTools.length;

  function toggleSkill(skill: SkillSummary) {
    if (!skill.enabled) return;
    setSelectedSkillIds((current) =>
      current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id],
    );
  }

  function toggleTool(tool: ToolSummary) {
    if (!tool.enabled) return;
    setSelectedToolIds((current) =>
      current.includes(tool.id) ? current.filter((id) => id !== tool.id) : [...current, tool.id],
    );
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedSkillIds([]);
      setSelectedToolIds([]);
    } else {
      setSelectedSkillIds(enabledSkills.map((skill) => skill.id));
      setSelectedToolIds(allowedEnabledTools.map((tool) => tool.id));
    }
  }

  function addMandatory(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setMandatory((current) => (current.includes(trimmed) ? current : [...current, trimmed]));
  }

  async function saveConfig() {
    if (savingConfig) return;
    const parsedTemperature = Number(temperature);
    const parsedMaxTokens = Number(maxTokens);
    if (!Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2) {
      toast.error('Temperature 必须在 0–2 之间');
      return;
    }
    if (!Number.isInteger(parsedMaxTokens) || parsedMaxTokens < 100 || parsedMaxTokens > 32000) {
      toast.error('Max tokens 必须是 100–32000 的整数');
      return;
    }
    if (systemPrompt.trim().length < 20) {
      toast.error('Planner System Prompt 至少需要 20 个字符');
      return;
    }
    setSavingConfig(true);
    const result = await apiRequest<{ config: PlannerOverviewResponse['config'] }>('/api/planner', {
      method: 'PUT',
      body: jsonBody({
        model,
        temperature: parsedTemperature,
        maxTokens: parsedMaxTokens,
        systemPrompt,
        requiredSkills: [...new Set([...requiredSkills, 'risk-check'])],
        baseTools,
        priceTools,
      }),
    });
    setSavingConfig(false);
    if (!result.ok) {
      toast.error('Planner 配置保存失败', { description: result.error });
      setError(result.error);
      return;
    }
    setOverview((current) =>
      current ? { ...current, config: result.data.config } : current,
    );
    setRequiredSkills([...new Set([...result.data.config.requiredSkills, 'risk-check'])]);
    setBaseTools(result.data.config.baseTools);
    setPriceTools(result.data.config.priceTools);
    const allowed = new Set([...result.data.config.baseTools, ...result.data.config.priceTools]);
    setSelectedToolIds((current) =>
      current.filter((id) => allowed.has(id)),
    );
    toast.success('Planner 配置已保存', {
      description: '下一次 Planner 调用会使用新的 Prompt、模型参数和能力规则。',
    });
  }

  async function runPreview() {
    if (previewing) return;
    if (!question.trim()) {
      toast.error('请输入测试问题');
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    setPreview(null);
    const result = await apiRequest<PlannerPreviewResponse>('/api/planner/preview', {
      method: 'POST',
      body: jsonBody({
        userInput: question.trim(),
        skillIds: selectedSkillIds,
        toolIds: selectedToolIds,
        mandatoryCapabilities: mandatory,
        provider: 'auto',
      }),
    });
    setPreviewing(false);
    if (!result.ok) {
      setPreviewError(result.error);
      toast.error('计划预览失败', { description: result.error });
      return;
    }
    setPreview(result.data);
    toast.success(result.data.validation.valid ? '计划预览通过校验' : '计划已生成，但校验未通过', {
      description: result.data.validation.valid
        ? '预览不会执行 Skill 或 Tool。'
        : result.data.validation.errors[0]?.message,
    });
  }

  if (loading) {
    return (
      <div className="page-stack">
        <div className="empty-state min-h-[420px]">
          <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden />
          <p className="text-xs">正在加载 Planner 配置与启用能力…</p>
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="page-stack">
        <div className="empty-state min-h-[420px]">
          <AlertCircle className="size-6 text-primary" aria-hidden />
          <p className="text-xs font-medium">Planner 管理加载失败</p>
          <p className="max-w-md text-[11px] leading-5">{error}</p>
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
          <p className="eyebrow">AGENT CONTROL / PLANNER</p>
          <h1 className="page-title">Planner 管理</h1>
          <p className="page-subtitle">
            查看 Planner 版本与 Prompt，选择本次可用的启用能力，设置强制能力并预览计划。预览只做规划与独立校验，不执行 Tool。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{overview?.plannerVersion ?? 'planner'}</Badge>
          <Badge tone="success">{enabledSkills.length} Skill</Badge>
          <Badge tone="neutral">{enabledTools.length} Tool</Badge>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw aria-hidden />
            刷新能力
          </Button>
        </div>
      </header>

      {error ? (
        <div role="alert" className="alert alert-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="planner-layout">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal className="size-4 text-primary" aria-hidden />
                Planner 版本与配置
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 text-[11px] sm:grid-cols-2">
                <p><span className="text-muted-foreground">版本：</span><span className="font-mono">{overview?.plannerVersion}</span></p>
                <p><span className="text-muted-foreground">配置版本：</span><span className="font-mono">{overview?.config.version}</span></p>
              </div>
              <div className="form-grid">
                <label className="field-group col-span-2">
                  <span className="field-label">Planner 模型 · provider-default 或具体模型名</span>
                  <Input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    maxLength={160}
                    placeholder="provider-default"
                  />
                </label>
                <label className="field-group">
                  <span className="field-label">Temperature · 0–2</span>
                  <Input
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={temperature}
                    onChange={(event) => setTemperature(event.target.value)}
                  />
                </label>
                <label className="field-group">
                  <span className="field-label">最大输出 Tokens</span>
                  <Input
                    type="number"
                    min={100}
                    max={32000}
                    step={100}
                    value={maxTokens}
                    onChange={(event) => setMaxTokens(event.target.value)}
                  />
                </label>
              </div>
              <label className="field-group">
                <span className="field-label">Planner System Prompt · 可配置</span>
                <Textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  className="min-h-[360px] font-mono text-[11px] leading-6"
                  maxLength={50000}
                  spellCheck={false}
                />
                <span className="field-hint">
                  保存后实际 Planner 使用此模板。支持占位符：
                  <code>{'{{availableSkills}}'}</code>、<code>{'{{availableTools}}'}</code>、
                  <code>{'{{mandatoryCapabilities}}'}</code>、<code>{'{{riskSignals}}'}</code>、
                  <code>{'{{userInput}}'}</code>、<code>{'{{conversationHistory}}'}</code>。
                </span>
              </label>

              <div className="planner-rule-grid">
                <fieldset className="planner-rule-group">
                  <legend>必经 Skill</legend>
                  <p>每次规划都必须出现；risk-check 固定保留，不能被配置移除。</p>
                  <div className="planner-rule-options">
                    {enabledSkills.map((skill) => {
                      const locked = skill.id === 'risk-check';
                      const checked = locked || requiredSkills.includes(skill.id);
                      return (
                        <label key={skill.id} className="tool-check">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked}
                            onChange={() =>
                              setRequiredSkills((current) =>
                                current.includes(skill.id)
                                  ? current.filter((id) => id !== skill.id)
                                  : [...current, skill.id],
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[11px]">{skill.name}</span>
                            <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
                              skill:{skill.id}{locked ? ' · 固定' : ''}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset className="planner-rule-group">
                  <legend>基础 Tool</legend>
                  <p>Planner 的常备可用 Tool；与价格 Tool 的并集构成可用 Tool 白名单。</p>
                  <div className="planner-rule-options">
                    {enabledTools.map((tool) => {
                      const checked = baseTools.includes(tool.id);
                      return (
                        <label key={tool.id} className="tool-check">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setBaseTools((current) =>
                                current.includes(tool.id)
                                  ? current.filter((id) => id !== tool.id)
                                  : [...current, tool.id],
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[11px]">{tool.name}</span>
                            <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
                              tool:{tool.id}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset className="planner-rule-group">
                  <legend>价格相关 Tool</legend>
                  <p>价格场景下作为强制 Tool；同时纳入可用 Tool 白名单。</p>
                  <div className="planner-rule-options">
                    {enabledTools.map((tool) => {
                      const checked = priceTools.includes(tool.id);
                      return (
                        <label key={tool.id} className="tool-check">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setPriceTools((current) =>
                                current.includes(tool.id)
                                  ? current.filter((id) => id !== tool.id)
                                  : [...current, tool.id],
                              )
                            }
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[11px]">{tool.name}</span>
                            <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
                              tool:{tool.id}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] leading-5 text-muted-foreground">
                  配置写入服务端，后续 Planner 调用立即读取。动态能力通过占位符注入；规则配置保存后生效。
                </p>
                <Button type="button" size="sm" onClick={saveConfig} disabled={savingConfig}>
                  {savingConfig ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                  {savingConfig ? '保存中…' : '保存 Planner 配置'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Layers3 className="size-4 text-primary" aria-hidden />
                  启用能力选择
                </CardTitle>
                <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
                  {allSelected ? '全不选' : '全选'}
                </Button>
              </div>
              <p className="text-[10px] leading-5 text-muted-foreground">
                页面列出全部 Skill / Tool；停用项不可选，也不会进入本次预览的可用能力。
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {enabledSkills.length === 0 && enabledTools.length === 0 ? (
                <div className="empty-state">
                  <AlertCircle className="size-5" aria-hidden />
                  <p className="text-xs">当前没有启用能力</p>
                  <p className="text-[11px]">请先在技能管理或工具管理中启用能力。</p>
                </div>
              ) : null}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="agent-label">Skill</p>
                  <span className="text-[10px] text-muted-foreground">{selectedSkillIds.length} / {enabledSkills.length} 已选</span>
                </div>
                <div className="planner-capability-grid">
                  {overview?.skills.map((skill) => (
                    <SkillCheckItem
                      key={skill.id}
                      skill={skill}
                      checked={selectedSkillIds.includes(skill.id)}
                      onToggle={() => toggleSkill(skill)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="agent-label">Tool</p>
                  <span className="text-[10px] text-muted-foreground">{selectedToolIds.length} / {allowedEnabledTools.length} 已选</span>
                </div>
                <div className="planner-capability-grid">
                  {overview?.tools.map((tool) => (
                    <ToolCheckItem
                      key={tool.id}
                      tool={tool}
                      checked={selectedToolIds.includes(tool.id)}
                      onToggle={() => toggleTool(tool)}
                      unavailableReason={allowedToolIds.has(tool.id) ? undefined : '未纳入 Tool 配置'}
                    />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-primary" aria-hidden />
                mandatoryCapabilities
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <select
                  className="field-select min-w-[220px] flex-1"
                  value={mandatoryPick}
                  onChange={(event) => {
                    setMandatoryPick(event.target.value);
                    if (event.target.value) addMandatory(event.target.value);
                    setMandatoryPick('');
                  }}
                  aria-label="添加强制能力"
                >
                  <option value="">从启用能力中添加…</option>
                  {mandatoryOptions
                    .filter((option) => !mandatory.includes(option.value))
                    .map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
              </div>
              <div className="flex gap-2">
                <Input
                  value={customMandatory}
                  onChange={(event) => setCustomMandatory(event.target.value)}
                  placeholder="自定义，例如 skill:risk-check"
                  className="font-mono text-[11px]"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      addMandatory(customMandatory);
                      setCustomMandatory('');
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    addMandatory(customMandatory);
                    setCustomMandatory('');
                  }}
                >
                  <Plus aria-hidden />
                  添加
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {mandatory.length === 0 ? (
                  <span className="text-[10px] text-muted-foreground">未设置手工强制能力；场景自动强制仍会生效。</span>
                ) : (
                  mandatory.map((capability) => (
                    <span key={capability} className="planner-chip">
                      {capability}
                      <button
                        type="button"
                        aria-label={`移除 ${capability}`}
                        onClick={() => setMandatory((current) => current.filter((item) => item !== capability))}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </span>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Workflow className="size-4 text-primary" aria-hidden />
                测试问题
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                className="min-h-[110px]"
                maxLength={6000}
                placeholder="输入用户问题，预览 Planner 计划和校验结果。"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] text-muted-foreground">
                  使用当前 Provider / 模型；Provider 配置见模型管理。
                </p>
                <Button type="button" onClick={runPreview} disabled={previewing}>
                  {previewing ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}
                  {previewing ? '预览中…' : '预览计划'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="planner-preview-panel">
            <CardContent className="pt-5">
              {previewing ? (
                <div className="empty-state min-h-[360px]">
                  <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden />
                  <p className="text-xs">Planner 正在生成计划并执行独立校验…</p>
                </div>
              ) : previewError ? (
                <div className="empty-state min-h-[360px]">
                  <AlertCircle className="size-6 text-primary" aria-hidden />
                  <p className="text-xs font-medium">计划预览失败</p>
                  <p className="max-w-md text-[11px] leading-5">{previewError}</p>
                </div>
              ) : preview ? (
                <PreviewBlock preview={preview} />
              ) : (
                <div className="empty-state min-h-[360px]">
                  <Workflow className="size-8 text-primary" aria-hidden />
                  <p className="text-sm font-medium">还没有预览结果</p>
                  <p className="max-w-sm text-[11px] leading-5">
                    选择可用能力、设置强制能力并输入测试问题，点击“预览计划”。这里只生成 Plan 和校验，不执行 Tool。
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="page-note">
        Planner 只能从当前启用能力中选择。预览失败会显示 PLAN_PARSE_FAILED、MISSING_*、CAPABILITY_UNAVAILABLE 等明确原因；正式 Agent 运行仍会经过 Executor、Tool、风险审核与 RunRecord 持久化。
      </p>

    </div>
  );
}
