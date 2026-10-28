import 'server-only';

import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { readCollection, updateCollection } from '@/lib/store';
import type { PlannerConfig } from '@/lib/schemas';

export const PLANNER_VERSION = 'planner.v2.1';

export const plannerConfigUpdateSchema = z
  .object({
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().min(100).max(32000),
    model: z.string().trim().min(1).max(160).optional(),
    systemPrompt: z.string().min(20, 'Planner System Prompt 至少需要 20 个字符').max(50000).optional(),
    requiredSkills: z.array(z.string().trim().min(1)).max(60).optional(),
    baseTools: z.array(z.string().trim().min(1)).max(30).optional(),
    priceTools: z.array(z.string().trim().min(1)).max(30).optional(),
  })
  .strict();

export async function getPlannerConfig(): Promise<PlannerConfig> {
  return readCollection('planner-config');
}

export async function updatePlannerConfig(
  raw: unknown,
): Promise<PlannerConfig> {
  const input = plannerConfigUpdateSchema.parse(raw);
  const [skills, tools] = await Promise.all([
    readCollection('skills'),
    readCollection('tools'),
  ]);
  const skillIds = new Set(skills.map((skill) => skill.id));
  const toolIds = new Set(tools.map((tool) => tool.id));
  const unknownSkills = (input.requiredSkills ?? []).filter((id) => !skillIds.has(id));
  const unknownTools = [...(input.baseTools ?? []), ...(input.priceTools ?? [])].filter(
    (id) => !toolIds.has(id),
  );
  if (unknownSkills.length > 0 || unknownTools.length > 0) {
    throw new AppError(
      400,
      'UNKNOWN_PLANNER_CAPABILITY',
      `Planner 配置引用了不存在的能力：${[...unknownSkills.map((id) => `skill:${id}`), ...unknownTools.map((id) => `tool:${id}`)].join('、')}`,
    );
  }

  return updateCollection('planner-config', (current) => ({
    ...current,
    version: current.version || PLANNER_VERSION,
    model: input.model ?? current.model,
    systemPrompt: input.systemPrompt ?? current.systemPrompt,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    requiredSkills: [...new Set(input.requiredSkills ?? current.requiredSkills)],
    baseTools: [...new Set(input.baseTools ?? current.baseTools)],
    priceTools: [...new Set(input.priceTools ?? current.priceTools)],
    updatedAt: new Date().toISOString(),
  }));
}
