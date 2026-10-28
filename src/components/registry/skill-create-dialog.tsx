'use client';

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  FileText,
  LoaderCircle,
  Save,
  WandSparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest, jsonBody } from '@/lib/client';
import type {
  SkillConfigIssue,
  SkillCreatePayload,
  SkillDetail,
  SkillDraftResponse,
  SkillSummary,
  ToolSummary,
} from '@/lib/types';

type CreateForm = {
  id: string;
  name: string;
  description: string;
  category: string;
  model: string;
  temperature: string;
  maxTokens: string;
  requiredTools: string[];
  systemPrompt: string;
  enabled: boolean;
};

const ID_PATTERN = /^[\p{L}\p{N}_-]{1,80}$/u;

function defaultPrompt(): string {
  return `# 新客服 Skill

## 触发场景
- 待填写：用户在什么情况下需要调用这个 Skill？

## 指令
1. 先确认用户诉求和已知信息。
2. 只引用真实 Tool 数据和上下文，不编造事实。
3. 按步骤完成本 Skill 的目标。

## 输出要求
- 使用简洁中文。
- 明确下一步或需要人工确认的内容。

## 安全边界
- 不承诺超出售后政策的退款、补发或赔偿。
- 不索取验证码、银行卡密码，不引导转账。`;
}

function emptyForm(): CreateForm {
  return {
    id: `custom-skill-${Date.now().toString(36).slice(-6)}`,
    name: '',
    description: '',
    category: '对话',
    model: 'snackops-fixture-v1',
    temperature: '0.2',
    maxTokens: '1200',
    requiredTools: [],
    systemPrompt: defaultPrompt(),
    enabled: true,
  };
}

function validateForm(
  form: CreateForm,
  existingSkills: SkillSummary[],
  tools: ToolSummary[],
): SkillConfigIssue[] {
  const issues: SkillConfigIssue[] = [];
  if (!ID_PATTERN.test(form.id) || form.id.includes('..')) {
    issues.push({
      code: 'INVALID_ID',
      message: 'ID 只能包含中英文字母、数字、下划线和连字符。',
      severity: 'error',
    });
  }
  if (existingSkills.some((skill) => skill.id === form.id)) {
    issues.push({ code: 'DUPLICATE_ID', message: 'Skill ID 已存在。', severity: 'error' });
  }
  if (
    existingSkills.some(
      (skill) =>
        skill.name.trim().toLocaleLowerCase('zh-CN') ===
        form.name.trim().toLocaleLowerCase('zh-CN'),
    )
  ) {
    issues.push({ code: 'DUPLICATE_NAME', message: 'Skill 名称已存在。', severity: 'error' });
  }
  if (!form.name.trim()) {
    issues.push({ code: 'NAME_REQUIRED', message: '请填写 Skill 名称。', severity: 'error' });
  }
  if (!form.description.trim()) {
    issues.push({ code: 'DESCRIPTION_REQUIRED', message: '请填写触发描述。', severity: 'error' });
  }
  if (!form.category.trim()) {
    issues.push({ code: 'CATEGORY_REQUIRED', message: '请填写分类。', severity: 'error' });
  }
  if (!form.model.trim()) {
    issues.push({ code: 'MODEL_REQUIRED', message: '请填写模型名称。', severity: 'error' });
  }
  const temperature = Number(form.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    issues.push({ code: 'INVALID_TEMPERATURE', message: 'Temperature 必须在 0–2 之间。', severity: 'error' });
  }
  const maxTokens = Number(form.maxTokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 100 || maxTokens > 32000) {
    issues.push({ code: 'INVALID_MAX_TOKENS', message: 'Max tokens 必须是 100–32000 的整数。', severity: 'error' });
  }
  if (form.systemPrompt.trim().length < 20) {
    issues.push({ code: 'PROMPT_TOO_SHORT', message: 'SKILL.md 至少需要 20 个字符。', severity: 'error' });
  }
  const toolIds = new Set(tools.map((tool) => tool.id));
  for (const toolId of form.requiredTools) {
    if (!toolIds.has(toolId)) {
      issues.push({ code: 'TOOL_MISSING', message: `依赖工具 ${toolId} 不存在。`, severity: 'error' });
    }
  }
  return issues;
}

function payloadFrom(form: CreateForm): SkillCreatePayload {
  return {
    id: form.id.trim(),
    name: form.name.trim(),
    description: form.description.trim(),
    category: form.category.trim(),
    model: form.model.trim(),
    temperature: Number(form.temperature),
    maxTokens: Number(form.maxTokens),
    requiredTools: form.requiredTools,
    systemPrompt: form.systemPrompt,
    enabled: form.enabled,
  };
}

export function SkillCreateDialog({
  tools,
  existingSkills,
  onClose,
  onCreated,
}: {
  tools: ToolSummary[];
  existingSkills: SkillSummary[];
  onClose: () => void;
  onCreated: (skill: SkillDetail) => void;
}) {
  const [mode, setMode] = useState<'manual' | 'ai'>('manual');
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [aiDescription, setAiDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftValid, setDraftValid] = useState<boolean | null>(null);
  const [draftIssues, setDraftIssues] = useState<SkillConfigIssue[]>([]);
  const [triggerScenarios, setTriggerScenarios] = useState<string[]>([]);
  const [reviewNotes, setReviewNotes] = useState<string[]>([]);
  const [draftMeta, setDraftMeta] = useState<{ provider: string; model: string; isDemo: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issues = useMemo(
    () => validateForm(form, existingSkills, tools),
    [existingSkills, form, tools],
  );
  const filePath = `skills/${form.id || '<id>'}/SKILL.md`;

  async function generateDraft() {
    if (generating) return;
    if (aiDescription.trim().length < 10) {
      toast.error('请至少描述 10 个字符的能力需求');
      return;
    }
    setGenerating(true);
    setError(null);
    const result = await apiRequest<SkillDraftResponse>('/api/skills/draft', {
      method: 'POST',
      body: jsonBody({ description: aiDescription.trim() }),
    });
    setGenerating(false);
    if (!result.ok) {
      setError(result.error);
      toast.error('AI 草案生成失败', { description: result.error });
      return;
    }

    const { draft } = result.data;
    setForm({
      id: draft.id,
      name: draft.name,
      description: draft.description,
      category: draft.category,
      model: draft.model,
      temperature: String(draft.temperature),
      maxTokens: String(draft.maxTokens),
      requiredTools: draft.requiredTools,
      systemPrompt: draft.systemPrompt,
      enabled: draft.enabled ?? true,
    });
    setDraftValid(result.data.validation.valid);
    setDraftIssues(result.data.validation.issues);
    setTriggerScenarios(draft.triggerScenarios);
    setReviewNotes(draft.reviewNotes);
    setDraftMeta({
      provider: result.data.provider,
      model: result.data.model,
      isDemo: result.data.isDemo,
    });
    toast.success('AI 草案已生成', {
      description: result.data.validation.valid
        ? '请在保存前人工审阅并编辑。'
        : '草案仍有校验问题，请修复后再保存。',
    });
  }

  async function save() {
    if (saving) return;
    if (mode === 'ai' && draftValid === null) {
      toast.error('请先生成 AI 草案并审阅');
      return;
    }
    const currentIssues = validateForm(form, existingSkills, tools);
    if (currentIssues.length > 0) {
      setError(currentIssues.map((issue) => issue.message).join('；'));
      toast.error('请先修复表单问题');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await apiRequest<{ skill: SkillDetail }>('/api/skills', {
      method: 'POST',
      body: jsonBody(payloadFrom(form)),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      toast.error('创建 Skill 失败', { description: result.error });
      return;
    }
    toast.success('Skill 已创建', {
      description: `${result.data.skill.name} · v${result.data.skill.version}`,
    });
    onCreated(result.data.skill);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="新增 Skill"
      description="手动配置，或描述能力后由 AI 生成标准草案。任何草案都必须经过格式、依赖与人工审阅后才能保存。"
      className="max-w-4xl"
    >
      <div className="space-y-4">
        <div className="registry-tabs registry-tabs-inline" role="tablist" aria-label="创建方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'manual'}
            className={mode === 'manual' ? 'active' : ''}
            onClick={() => setMode('manual')}
          >
            <FileText className="size-3.5" aria-hidden />
            手动配置
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'ai'}
            className={mode === 'ai' ? 'active' : ''}
            onClick={() => setMode('ai')}
          >
            <Bot className="size-3.5" aria-hidden />
            AI Create Skill
          </button>
        </div>

        {mode === 'ai' ? (
          <section className="create-ai-panel">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">描述能力，生成标准草案</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  AI 只生成草案，不会直接保存。生成后会进入下方人工预览编辑。
                </p>
              </div>
              <Badge tone="neutral">课堂 fixture 可用</Badge>
            </div>
            <Textarea
              value={aiDescription}
              onChange={(event) => setAiDescription(event.target.value)}
              className="mt-3 min-h-[88px]"
              placeholder="例如：当用户询问订单缺件或破损时，先查询订单和售后政策，判断是否符合补发条件，并给出安全、克制的处理建议。"
              maxLength={2000}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={generateDraft} disabled={generating}>
                {generating ? <LoaderCircle className="animate-spin" aria-hidden /> : <WandSparkles aria-hidden />}
                {generating ? '生成中…' : 'AI 生成标准草案'}
              </Button>
              {draftMeta ? (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {draftMeta.isDemo ? '课堂演示' : '真实模型'} · {draftMeta.provider} / {draftMeta.model}
                </span>
              ) : null}
            </div>

            {draftValid !== null ? (
              <div className={`mt-3 rounded-md border px-3 py-2 ${draftValid ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <p className={`flex items-center gap-1.5 text-[11px] font-semibold ${draftValid ? 'text-emerald-800' : 'text-amber-900'}`}>
                  {draftValid ? <CheckCircle2 className="size-3.5" aria-hidden /> : <AlertCircle className="size-3.5" aria-hidden />}
                  {draftValid ? '草案格式与依赖校验通过，等待人工审阅' : '草案存在校验问题，请编辑后保存'}
                </p>
                {draftIssues.length > 0 ? (
                  <ul className="mt-1.5 space-y-1 text-[10px] leading-5">
                    {draftIssues.map((issue) => (
                      <li key={`${issue.code}-${issue.message}`}>
                        <span className="font-mono">{issue.code}</span> · {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {triggerScenarios.length > 0 ? (
              <div className="mt-3">
                <p className="agent-label">AI 识别的触发场景</p>
                <ul className="mt-1 list-inside list-disc text-[10px] leading-5 text-muted-foreground">
                  {triggerScenarios.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {reviewNotes.length > 0 ? (
              <div className="mt-2">
                <p className="agent-label">需要人工确认</p>
                <ul className="mt-1 list-inside list-disc text-[10px] leading-5 text-muted-foreground">
                  {reviewNotes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="form-grid">
          <label className="field-group">
            <span className="field-label">Skill ID</span>
            <Input
              value={form.id}
              onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))}
              maxLength={80}
            />
          </label>
          <label className="field-group">
            <span className="field-label">Skill 名称</span>
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="例如：缺件补发判断"
              maxLength={80}
            />
          </label>
          <div className="field-group col-span-2">
            <span className="field-label">文件路径</span>
            <code className="rounded-md border bg-muted/30 px-2.5 py-2 font-mono text-[10px] text-muted-foreground">
              {filePath}
            </code>
          </div>
          <label className="field-group col-span-2">
            <span className="field-label">触发描述（Planner 会读取）</span>
            <Textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              className="min-h-[64px]"
              maxLength={500}
              placeholder="说明用户在什么情况下应该使用这个 Skill，以及它能解决什么问题。"
            />
          </label>
          <label className="field-group">
            <span className="field-label">分类</span>
            <Input
              value={form.category}
              onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
              maxLength={40}
            />
          </label>
          <label className="field-group">
            <span className="field-label">模型</span>
            <Input
              value={form.model}
              onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
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
              onChange={(event) => setForm((current) => ({ ...current, temperature: event.target.value }))}
            />
          </label>
          <label className="field-group">
            <span className="field-label">最大输出 Tokens</span>
            <Input
              type="number"
              min={100}
              max={32000}
              step={100}
              value={form.maxTokens}
              onChange={(event) => setForm((current) => ({ ...current, maxTokens: event.target.value }))}
            />
          </label>
          <label className="field-group col-span-2 flex-row items-center gap-2">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <span className="field-label">创建后立即启用</span>
          </label>
        </div>

        <fieldset className="field-group">
          <legend className="field-label">依赖工具</legend>
          <div className="tool-check-grid">
            {tools.map((tool) => {
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
            })}
          </div>
        </fieldset>

        <label className="field-group">
          <span className="field-label">System prompt / SKILL.md</span>
          <Textarea
            value={form.systemPrompt}
            onChange={(event) => setForm((current) => ({ ...current, systemPrompt: event.target.value }))}
            className="min-h-[280px] font-mono text-[11px] leading-6"
            maxLength={50000}
            spellCheck={false}
          />
        </label>

        {issues.length > 0 ? (
          <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-900">
              <AlertCircle className="size-3.5" aria-hidden />
              保存前还有 {issues.length} 个问题
            </p>
            <ul className="mt-1 list-inside list-disc text-[10px] leading-5 text-amber-900">
              {issues.map((issue) => (
                <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="alert alert-danger">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <p className="text-[10px] text-muted-foreground">
            创建后会生成 `skills/&lt;id&gt;/SKILL.md` 和 v1.0.0 初始快照。
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="button" onClick={save} disabled={saving || issues.length > 0}>
              {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              {saving ? '保存中…' : '保存 Skill'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
