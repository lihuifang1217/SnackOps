import 'server-only';

import { z } from 'zod';
import { readCollection, updateCollection } from '@/lib/store';
import type { Improvement } from '@/lib/schemas';
import type {
  PromptDraftResponse,
  SkillVersionDetail,
  AbTest,
} from '@/lib/types';
import { createDraftSkillVersion, getSkillVersion } from '@/lib/registry/skills';
import { createAbTest, listAbTests } from './ab-tests';
import { generatePromptDraft } from './improvements';

export const createPromptVersionSchema = z
  .object({
    improvementId: z.string().trim().min(1).max(160).optional(),
    clusterId: z.string().trim().min(1).max(240).optional(),
    skillId: z.string().trim().min(1).max(80).optional(),
    changeNote: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.improvementId || value.clusterId), {
    message: '需要 improvementId 或 clusterId',
  });

export type PromptVersionCreateResponse = {
  draft: PromptDraftResponse;
  version: SkillVersionDetail;
  abTest: AbTest;
  improvement: Improvement | null;
};

export async function createPromptVersionAndAbDraft(
  raw: unknown,
): Promise<PromptVersionCreateResponse> {
  const input = createPromptVersionSchema.parse(raw);
  const draft = await generatePromptDraft({
    ...(input.improvementId ? { improvementId: input.improvementId } : {}),
    ...(input.clusterId ? { clusterId: input.clusterId } : {}),
    ...(input.skillId ? { skillId: input.skillId } : {}),
  });
  const sourceTitle = draft.cluster?.title ?? draft.improvement?.title ?? 'Skill Prompt';
  const changeNote =
    input.changeNote ?? `A/B 草稿：${sourceTitle}`;

  const existingTests = await listAbTests();
  const existing = draft.improvement
    ? existingTests.find(
        (test) =>
          test.status === '草稿' &&
          test.sourceImprovementId === draft.improvement?.id &&
          test.skillId === draft.skill.id &&
          test.promptB === draft.draftPrompt,
      )
    : draft.cluster
      ? existingTests.find(
          (test) =>
            test.status === '草稿' &&
            test.sourceClusterId === draft.cluster?.id &&
            test.skillId === draft.skill.id &&
            test.promptB === draft.draftPrompt,
        )
      : undefined;

  let version: SkillVersionDetail;
  let abTest: AbTest;
  if (existing?.draftVersionId) {
    version = await getSkillVersion(draft.skill.id, existing.draftVersionId);
    abTest = existing;
  } else {
    version = await createDraftSkillVersion(draft.skill.id, {
      systemPrompt: draft.draftPrompt,
      changeNote,
      expectedHash: draft.currentHash,
    });
    abTest = await createAbTest({
      name: `A/B · ${draft.skill.name} · ${sourceTitle}`,
      variantA: `原版本 ${draft.skill.version}`,
      variantB: `新版本 ${version.version}`,
      promptA: draft.currentPrompt,
      promptB: draft.draftPrompt,
      skillId: draft.skill.id,
      metric: '人工评估',
      sampleSize: 0,
      trafficA: 50,
      trafficB: 50,
      enabledA: true,
      enabledB: true,
      ...(draft.improvement?.id ? { sourceImprovementId: draft.improvement.id } : {}),
      ...(draft.cluster?.id ? { sourceClusterId: draft.cluster.id } : {}),
      baseVersion: draft.skill.version,
      baseHash: draft.currentHash,
      draftVersionId: version.id,
      draftVersion: version.version,
    });
  }

  let improvement: Improvement | null = draft.improvement;
  if (draft.improvement) {
    await updateCollection('improvements', (current) =>
      current.map((item) =>
        item.id === draft.improvement?.id
          ? {
              ...item,
              status: '进行中' as const,
              targetSkillId: draft.skill.id,
              promptDraft: draft.draftPrompt,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
    improvement =
      (await readCollection('improvements')).find((item) => item.id === draft.improvement?.id) ??
      draft.improvement;
  }

  return { draft, version, abTest, improvement };
}
