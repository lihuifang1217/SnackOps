import { createHash } from 'node:crypto';
import type { Skill } from '@/lib/schemas';
import { normalizePrompt } from './skill-files';

export type RevisionSource = Pick<
  Skill,
  'description' | 'model' | 'temperature' | 'maxTokens' | 'requiredTools'
>;

/**
 * hash 覆盖提示词和可编辑元数据，用于乐观并发控制与快照校验。
 * 启用状态不参与 hash，因为启停不应迫使运营创建新提示词版本。
 */
export function computeRevisionHash(skill: RevisionSource, systemPrompt: string): string {
  const payload = JSON.stringify({
    description: skill.description,
    model: skill.model,
    temperature: skill.temperature,
    maxTokens: skill.maxTokens,
    requiredTools: [...skill.requiredTools].sort(),
    systemPrompt: normalizePrompt(systemPrompt),
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
