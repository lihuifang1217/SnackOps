import 'server-only';

import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { readCollection, updateCollection } from '@/lib/store';
import type { AbTest, Improvement } from '@/lib/schemas';
import { applyDraftSkillVersion, getSkillDetail, saveSkillVersion } from '@/lib/registry/skills';

const skillId = z.string().trim().min(1).max(80).optional();
const traffic = z.number().int().min(0).max(100).optional();
const text = z.string().trim().min(1).max(20000).optional();

export const abTestCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    variantA: text,
    variantB: text,
    promptA: text,
    promptB: text,
    metric: z.string().trim().min(1).max(120).optional(),
    sampleSize: z.number().int().min(0).max(1_000_000).optional(),
    skillId: skillId,
    skillAId: skillId,
    skillBId: skillId,
    trafficA: traffic,
    trafficB: traffic,
    enabledA: z.boolean().optional(),
    enabledB: z.boolean().optional(),
    sourceImprovementId: z.string().optional(),
    sourceClusterId: z.string().optional(),
    baseVersion: z.string().optional(),
    baseHash: z.string().optional(),
    draftVersionId: z.string().optional(),
    draftVersion: z.string().optional(),
  })
  .strict();

export const abTestUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    variantA: text,
    variantB: text,
    promptA: text,
    promptB: text,
    metric: z.string().trim().min(1).max(120).optional(),
    sampleSize: z.number().int().min(0).max(1_000_000).optional(),
    status: z.enum(['草稿', '运行中', '已结束', '确认应用']).optional(),
    skillId: skillId,
    skillAId: skillId,
    skillBId: skillId,
    trafficA: traffic,
    trafficB: traffic,
    enabledA: z.boolean().optional(),
    enabledB: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要一个 A/B 更新字段',
  });

export async function listAbTests(): Promise<AbTest[]> {
  return readCollection('ab-tests');
}

async function assertSkill(skillIdValue: string | undefined): Promise<void> {
  if (!skillIdValue) return;
  try {
    await getSkillDetail(skillIdValue);
  } catch {
    throw new AppError(400, 'UNKNOWN_AB_SKILL', `A/B 实验引用的 Skill 不存在：${skillIdValue}`);
  }
}

function primarySkill(input: {
  skillId?: string;
  skillAId?: string;
  skillBId?: string;
}): string | undefined {
  return input.skillId ?? input.skillAId ?? input.skillBId;
}

function promptSnapshot(textValue: string | undefined, fallback: string): string {
  return (textValue ?? fallback).slice(0, 20000);
}

export async function createAbTest(raw: unknown): Promise<AbTest> {
  const input = abTestCreateSchema.parse(raw);
  const skill = primarySkill(input);
  await assertSkill(skill);
  const promptA = promptSnapshot(input.promptA ?? input.variantA, 'A 版本 Prompt');
  const promptB = promptSnapshot(input.promptB ?? input.variantB, 'B 版本 Prompt');
  const abTest: AbTest = {
    id: `ab-${Date.now()}`,
    name: input.name,
    status: '草稿',
    variantA: input.variantA ?? promptA.slice(0, 120),
    variantB: input.variantB ?? promptB.slice(0, 120),
    metric: input.metric ?? '人工评估',
    sampleSize: input.sampleSize ?? 0,
    skillId: skill,
    promptA,
    promptB,
    trafficA: input.trafficA ?? 50,
    trafficB: input.trafficB ?? 50,
    enabledA: input.enabledA ?? true,
    enabledB: input.enabledB ?? true,
    ...(input.sourceImprovementId ? { sourceImprovementId: input.sourceImprovementId } : {}),
    ...(input.sourceClusterId ? { sourceClusterId: input.sourceClusterId } : {}),
    ...(input.baseVersion ? { baseVersion: input.baseVersion } : {}),
    ...(input.baseHash ? { baseHash: input.baseHash } : {}),
    ...(input.draftVersionId ? { draftVersionId: input.draftVersionId } : {}),
    ...(input.draftVersion ? { draftVersion: input.draftVersion } : {}),
    updatedAt: new Date().toISOString(),
  };
  await updateCollection('ab-tests', (current) => [abTest, ...current]);
  return abTest;
}

export async function updateAbTest(id: string, raw: unknown): Promise<AbTest> {
  const input = abTestUpdateSchema.parse(raw);
  const skill = primarySkill(input);
  await assertSkill(skill);
  let updated: AbTest | null = null;
  await updateCollection('ab-tests', (current) => {
    const existing = current.find((item) => item.id === id);
    if (!existing) throw new AppError(404, 'AB_TEST_NOT_FOUND', 'A/B 实验不存在');
    updated = {
      ...existing,
      ...input,
      skillId: skill ?? existing.skillId,
      updatedAt: new Date().toISOString(),
    };
    return current.map((item) => (item.id === id ? updated! : item));
  });
  if (!updated) throw new AppError(404, 'AB_TEST_NOT_FOUND', 'A/B 实验不存在');
  return updated;
}


export async function confirmAbTest(id: string): Promise<{
  abTest: AbTest;
  skill: Awaited<ReturnType<typeof getSkillDetail>>;
  improvement: Improvement | null;
}> {
  const tests = await readCollection('ab-tests');
  const existing = tests.find((item) => item.id === id);
  if (!existing) throw new AppError(404, 'AB_TEST_NOT_FOUND', 'A/B 实验不存在');
  const skillId = existing.skillId ?? existing.skillAId ?? existing.skillBId;
  if (!skillId) throw new AppError(400, 'AB_SKILL_MISSING', 'A/B 实验未绑定 Skill');

  if (existing.status === '确认应用') {
    const skill = await getSkillDetail(skillId);
    const improvements = await readCollection('improvements');
    return {
      abTest: existing,
      skill,
      improvement:
        improvements.find((item) => item.id === existing.sourceImprovementId) ?? null,
    };
  }
  if (existing.status !== '草稿') {
    throw new AppError(409, 'AB_NOT_DRAFT', '只有草稿状态的 A/B 实验可以确认应用');
  }

  const promptB = existing.promptB ?? existing.variantB;
  const skill = existing.draftVersionId
    ? await applyDraftSkillVersion(skillId, existing.draftVersionId, {
        expectedHash: existing.baseHash,
        changeNote: `A/B 确认应用：${existing.name}`,
      })
    : await (async () => {
        const current = await getSkillDetail(skillId);
        return saveSkillVersion(skillId, {
          name: current.name,
          description: current.description,
          model: current.model,
          temperature: current.temperature,
          maxTokens: current.maxTokens,
          requiredTools: current.requiredTools,
          systemPrompt: promptB,
          changeNote: `A/B 确认应用：${existing.name}`,
          expectedHash: current.hash,
        });
      })();

  const confirmedAt = new Date().toISOString();
  const updated: AbTest = {
    ...existing,
    status: '确认应用',
    appliedVersion: skill.version,
    confirmedAt,
    updatedAt: confirmedAt,
  };
  await updateCollection('ab-tests', (current) =>
    current.map((item) => (item.id === id ? updated : item)),
  );

  let improvement: Improvement | null = null;
  if (existing.sourceImprovementId) {
    await updateCollection('improvements', (current) =>
      current.map((item) => {
        if (item.id !== existing.sourceImprovementId) return item;
        improvement = {
          ...item,
          status: '已完成',
          targetSkillId: skill.id,
          promptDraft: promptB,
          updatedAt: confirmedAt,
        };
        return improvement;
      }),
    );
  }

  return { abTest: updated, skill, improvement };
}
