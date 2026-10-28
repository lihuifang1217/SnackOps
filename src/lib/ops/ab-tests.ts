import 'server-only';

import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { readCollection, updateCollection } from '@/lib/store';
import type { AbTest } from '@/lib/schemas';
import { getSkillDetail } from '@/lib/registry/skills';

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
    status: z.enum(['草稿', '运行中', '已结束']).optional(),
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
