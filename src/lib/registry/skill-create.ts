import 'server-only';

import { randomUUID } from 'node:crypto';
import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import {
  readCollection,
  writeCollection,
} from '@/lib/store';
import type { Skill, SkillVersion } from '@/lib/schemas';
import type { SkillDetail } from '@/lib/types';
import { computeRevisionHash } from './hash';
import { withRegistryLock } from './lock';
import {
  canonicalSkillFilePath,
  normalizePrompt,
  resolveSkillPromptPath,
  validateSkillId,
  writeSkillPrompt,
} from './skill-files';
import { getSkillDetail } from './skills';

export const skillCreatePayloadSchema = z
  .object({
    id: z.string().trim().min(1, 'Skill ID 不能为空').max(80),
    name: z.string().trim().min(1, 'Skill 名称不能为空').max(80),
    description: z.string().trim().min(1, '触发描述不能为空').max(500),
    category: z.string().trim().min(1, '分类不能为空').max(40),
    model: z.string().trim().min(1, '模型不能为空').max(120),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().min(100).max(32000),
    requiredTools: z.array(z.string().min(1)).max(20),
    systemPrompt: z.string().min(20, 'SKILL.md 至少需要 20 个字符').max(50000),
    enabled: z.boolean().optional(),
  })
  .strict();

function standardizePrompt(name: string, prompt: string): string {
  const normalized = normalizePrompt(prompt);
  if (normalized.startsWith('#')) return normalized;
  return normalizePrompt(`# ${name}\n\n${normalized}`);
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function createSkill(raw: unknown): Promise<SkillDetail> {
  const input = skillCreatePayloadSchema.parse(raw);
  validateSkillId(input.id);

  return withRegistryLock('skills-registry', async () => {
    const [skills, versions, tools] = await Promise.all([
      readCollection('skills'),
      readCollection('skill-versions'),
      readCollection('tools'),
    ]);

    if (skills.some((skill) => skill.id === input.id)) {
      throw new AppError(409, 'SKILL_ID_EXISTS', `Skill ID「${input.id}」已存在`);
    }
    if (
      skills.some(
        (skill) =>
          skill.name.trim().toLocaleLowerCase('zh-CN') ===
          input.name.trim().toLocaleLowerCase('zh-CN'),
      )
    ) {
      throw new AppError(409, 'SKILL_NAME_EXISTS', `Skill 名称「${input.name}」已被使用`);
    }

    const toolIds = new Set(tools.map((tool) => tool.id));
    const unknownTools = [
      ...new Set(input.requiredTools),
    ].filter((toolId) => !toolIds.has(toolId));
    if (unknownTools.length > 0) {
      throw new AppError(
        400,
        'UNKNOWN_REQUIRED_TOOL',
        `依赖的工具不存在：${unknownTools.join('、')}`,
      );
    }

    const filePath = canonicalSkillFilePath(input.id);
    const draftSkill: Skill = {
      id: input.id,
      name: input.name,
      description: input.description,
      category: input.category,
      enabled: input.enabled ?? true,
      model: input.model,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      requiredTools: [...new Set(input.requiredTools)],
      version: '1.0.0',
      filePath,
      updatedAt: new Date().toISOString(),
    };
    const prompt = standardizePrompt(input.name, input.systemPrompt);
    const targetFile = resolveSkillPromptPath(draftSkill);
    if (await exists(targetFile)) {
      throw new AppError(409, 'SKILL_FILE_EXISTS', '目标 Skill 目录中已存在 SKILL.md');
    }
    if (await exists(path.dirname(targetFile))) {
      throw new AppError(409, 'SKILL_FILE_EXISTS', '目标 Skill 目录已存在');
    }

    const hash = computeRevisionHash(draftSkill, prompt);
    const snapshot: SkillVersion = {
      id: `ver-${Date.now()}-${randomUUID().slice(0, 8)}`,
      skillId: draftSkill.id,
      name: draftSkill.name,
      description: draftSkill.description,
      category: draftSkill.category,
      enabled: draftSkill.enabled,
      model: draftSkill.model,
      temperature: draftSkill.temperature,
      maxTokens: draftSkill.maxTokens,
      requiredTools: draftSkill.requiredTools,
      version: draftSkill.version,
      filePath: draftSkill.filePath,
      systemPrompt: prompt,
      hash,
      status: '当前',
      changeNote: '创建 Skill 初始版本',
      createdBy: '运营管理员',
      createdAt: draftSkill.updatedAt,
    };

    await writeSkillPrompt(draftSkill, prompt);
    try {
      await writeCollection('skills', [...skills, draftSkill]);
      await writeCollection('skill-versions', [...versions, snapshot]);
    } catch (error) {
      await writeCollection('skills', skills).catch(() => undefined);
      await rm(path.dirname(targetFile), { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }

    return getSkillDetail(draftSkill.id);
  });
}
