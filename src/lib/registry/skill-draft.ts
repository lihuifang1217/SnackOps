import 'server-only';

import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { detectInputSignals } from '@/lib/agent/signals';
import { createLlmClient } from '@/lib/llm/config';
import type {
  AgentProviderSelection,
  SkillConfigIssue,
  SkillDraft,
  SkillDraftResponse,
} from '@/lib/types';
import { listSkills } from './skills';
import { listTools } from './tools';
import { validateSkillId } from './skill-files';
import { skillCreatePayloadSchema } from './skill-create';

const draftSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  requiredTools: z.array(z.string()),
  systemPrompt: z.string().min(20),
  enabled: z.boolean().optional(),
  triggerScenarios: z.array(z.string()),
  reviewNotes: z.array(z.string()),
});

export const skillDraftRequestSchema = z
  .object({
    description: z.string().trim().min(10, '请至少描述 10 个字符').max(2000),
    provider: z
      .enum(['auto', 'classroom-fixture', 'openai-compatible', 'coze'])
      .optional(),
  })
  .strict();

function extractJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function draftSkill(input: {
  description: string;
  provider?: AgentProviderSelection;
}): Promise<SkillDraftResponse> {
  const [provider, existingSkills, tools] = await Promise.all([
    createLlmClient(input.provider ?? 'auto'),
    listSkills(),
    listTools(),
  ]);
  const enabledTools = tools.filter((tool) => tool.enabled);
  const signals = detectInputSignals(input.description);

  const generation = await provider.generate({
    messages: [
      {
        role: 'system',
        content: `你是 SnackOps 的 Skill 设计师。请把运营人员的能力描述转换成可审阅的 SKILL.md 草案。

只输出 JSON，不要 Markdown 围栏。结构：
{
  "id": "小写英文/数字/连字符 ID",
  "name": "Skill 中文名称",
  "description": "触发描述，说明何时应该使用",
  "category": "分类",
  "model": "模型名称",
  "temperature": 0.2,
  "maxTokens": 1200,
  "requiredTools": ["只能从当前启用工具中选择"],
  "systemPrompt": "完整 Markdown，至少包含 # 标题、## 触发场景、## 指令、## 输出要求、## 安全边界",
  "enabled": true,
  "triggerScenarios": ["触发场景 1", "触发场景 2"],
  "reviewNotes": ["需要人工确认的假设或依赖"]
}

当前启用工具：
${enabledTools.map((tool) => `- ${tool.id}: ${tool.name} — ${tool.description}`).join('\n') || '无'}

已有 Skill ID：${existingSkills.map((skill) => skill.id).join(', ') || '无'}
已有 Skill 名称：${existingSkills.map((skill) => skill.name).join(', ') || '无'}

要求：
- 不得编造不存在的 Tool ID。
- requiredTools 必须来自当前启用工具。
- 草案必须覆盖触发场景、指令、输出要求、安全边界。
- ID 与名称不得与现有 Skill 冲突。
- 不确定的内容写入 reviewNotes，不要假装已确认。`,
      },
      { role: 'user', content: input.description },
    ],
    temperature: 0.2,
    maxTokens: 2500,
    json: true,
    purpose: 'skill-draft',
    fixture: {
      task: 'skill-draft',
      userInput: input.description,
      conversationHistory: [],
      mandatoryCapabilities: [],
      signals,
      availableSkills: existingSkills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
      })),
      availableTools: enabledTools.map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
      })),
    },
  });

  const parsed = extractJson(generation.text);
  if (!parsed) {
    throw new AppError(
      422,
      'SKILL_DRAFT_PARSE_FAILED',
      'AI 生成的草案不是有效 JSON。没有保存任何 Skill，请重试或改用手动配置。',
    );
  }
  const parsedDraft = draftSchema.safeParse(parsed);
  if (!parsedDraft.success) {
    throw new AppError(
      422,
      'SKILL_DRAFT_INVALID',
      `AI 草案缺少必要字段：${parsedDraft.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .slice(0, 5)
        .join('；')}`,
    );
  }

  const draft = parsedDraft.data;
  const issues: SkillConfigIssue[] = [];
  try {
    validateSkillId(draft.id);
  } catch (error) {
    issues.push({
      code: 'INVALID_SKILL_ID',
      message: error instanceof Error ? error.message : 'Skill ID 不合法',
      severity: 'error',
    });
  }
  if (
    existingSkills.some(
      (skill) =>
        skill.name.trim().toLocaleLowerCase('zh-CN') ===
        draft.name.trim().toLocaleLowerCase('zh-CN'),
    )
  ) {
    issues.push({
      code: 'SKILL_NAME_EXISTS',
      message: `名称「${draft.name}」已存在，请修改。`,
      severity: 'error',
    });
  }
  if (existingSkills.some((skill) => skill.id === draft.id)) {
    issues.push({
      code: 'SKILL_ID_EXISTS',
      message: `ID「${draft.id}」已存在，请修改。`,
      severity: 'error',
    });
  }
  const toolIds = new Set(enabledTools.map((tool) => tool.id));
  const missingTools = draft.requiredTools.filter((toolId) => !toolIds.has(toolId));
  if (missingTools.length > 0) {
    issues.push({
      code: 'TOOL_DEPENDENCY_INVALID',
      message: `依赖工具不存在或未启用：${missingTools.join('、')}`,
      severity: 'error',
    });
  }

  const createCheck = skillCreatePayloadSchema.safeParse({
    id: draft.id,
    name: draft.name,
    description: draft.description,
    category: draft.category,
    model: draft.model,
    temperature: draft.temperature,
    maxTokens: draft.maxTokens,
    requiredTools: draft.requiredTools,
    systemPrompt: draft.systemPrompt,
    enabled: draft.enabled ?? true,
  });
  if (!createCheck.success) {
    for (const issue of createCheck.error.issues) {
      issues.push({
        code: 'DRAFT_FIELD_INVALID',
        message: `${issue.path.join('.') || 'draft'}：${issue.message}`,
        severity: 'error',
      });
    }
  }
  if (draft.triggerScenarios.length === 0) {
    issues.push({
      code: 'TRIGGER_MISSING',
      message: '草案缺少触发场景，建议补充后再保存。',
      severity: 'warning',
    });
  }

  return {
    draft: {
      ...draft,
      enabled: draft.enabled ?? true,
    } as SkillDraft,
    validation: {
      valid: !issues.some((issue) => issue.severity === 'error'),
      issues,
    },
    provider: generation.provider,
    model: generation.model,
    isDemo: generation.isDemo,
    availableTools: enabledTools,
  };
}
