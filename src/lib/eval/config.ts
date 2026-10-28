import 'server-only';

import { z } from 'zod';
import { readCollection, updateCollection } from '@/lib/store';
import { evalConfigSchema } from '@/lib/schemas';
import type { EvalConfig } from '@/lib/types';

export const DEFAULT_JUDGE_SYSTEM_PROMPT =
  '你是 SnackOps 零食客服评测中心的 LLM-as-Judge。请依据用户问题、期望回复、期望关键词、Tool 事实和实际最终回复，独立评估回复的相关性、完整性、事实准确性和表达质量。\n\n只输出 JSON：\n{\n  "score": 0-100,\n  "relevance": 0-100,\n  "completeness": 0-100,\n  "factuality": 0-100,\n  "tone": 0-100,\n  "reason": "一句话说明扣分或给分依据"\n}\n\n评分必须基于提供的证据，不得臆造事实；无法判断时 score 设为 null 并在 reason 中说明。';

export const evalConfigUpdateSchema = z
  .object({
    judgeEnabled: z.boolean().optional(),
    judgeSystemPrompt: z.string().trim().min(20).max(50000).optional(),
    judgeTemperature: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: '至少需要一个配置字段' });

export async function getEvalConfig(): Promise<EvalConfig> {
  const config = await readCollection('eval-config');
  return evalConfigSchema.parse(config);
}

export async function updateEvalConfig(raw: unknown): Promise<EvalConfig> {
  const input = evalConfigUpdateSchema.parse(raw);
  let updated: EvalConfig | null = null;
  await updateCollection('eval-config', (current) => {
    updated = {
      ...current,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    return updated;
  });
  return evalConfigSchema.parse(updated);
}
