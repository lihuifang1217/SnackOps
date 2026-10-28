import 'server-only';

import { randomUUID } from 'node:crypto';
import { AppError } from '@/lib/errors';
import { readCollection, updateCollection } from '@/lib/store';
import type { AgentHandoff, Annotation, Run } from '@/lib/schemas';
import { deriveQuestionType } from '@/lib/ops/rules';

export function createRunId(): string {
  return `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function createConversationId(): string {
  return `conv-${Date.now()}-${randomUUID().slice(0, 6)}`;
}

export async function createRun(run: Run): Promise<Run> {
  await updateCollection('runs', (current) => [run, ...current]);
  return run;
}

export async function updateRun(
  runId: string,
  update: (current: Run) => Run,
): Promise<Run> {
  let updated: Run | null = null;
  await updateCollection('runs', (current) => {
    const index = current.findIndex((run) => run.id === runId);
    if (index < 0) {
      throw new AppError(404, 'RUN_NOT_FOUND', '运行记录不存在');
    }
    const next = update(current[index]);
    updated = next;
    return current.map((run, itemIndex) => (itemIndex === index ? next : run));
  });
  if (!updated) throw new AppError(404, 'RUN_NOT_FOUND', '运行记录不存在');
  return updated;
}

export async function getRun(runId: string): Promise<Run> {
  const runs = await readCollection('runs');
  const run = runs.find((item) => item.id === runId);
  if (!run) throw new AppError(404, 'RUN_NOT_FOUND', '运行记录不存在');
  return run;
}

export async function listRuns(input: {
  page: number;
  limit: number;
}): Promise<{ runs: Run[]; page: number; limit: number; total: number; totalPages: number }> {
  const runs = await readCollection('runs');
  const sorted = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / input.limit));
  const page = Math.min(Math.max(1, input.page), totalPages);
  const start = (page - 1) * input.limit;
  return {
    runs: sorted.slice(start, start + input.limit),
    page,
    limit: input.limit,
    total,
    totalPages,
  };
}

export async function getAnnotations(runId: string): Promise<Annotation[]> {
  const annotations = await readCollection('annotations');
  return annotations
    .filter((annotation) => annotation.runId === runId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function annotateRun(input: {
  runId: string;
  label: string;
  note: string;
  annotator: string;
}): Promise<Annotation> {
  const run = await getRun(input.runId);
  const now = new Date().toISOString();
  const annotation: Annotation = {
    id: `ann-${Date.now()}-${randomUUID().slice(0, 6)}`,
    runId: input.runId,
    target: 'run',
    label: input.label,
    status: 'pending',
    origin: 'manual',
    question: run.question,
    answer: run.finalReply ?? '',
    expectedReply: '',
    intent: deriveQuestionType(run.question),
    riskLevel: run.riskResult?.riskLevel ?? 'none',
    qualityTags: [],
    requiredCapabilities: [
      ...(run.plan?.selectedSkills ?? []).map((id) => `skill:${id}`),
      ...(run.plan?.selectedTools ?? []).map((id) => `tool:${id}`),
    ],
    requiredSkills: (run.plan?.selectedSkills ?? []).map((id) => `skill:${id}`),
    expectedFacts: [],
    expectedToolFacts: [],
    forbiddenPhrases: [],
    failureReason: '',
    correctness: 3,
    relevance: 3,
    completeness: 3,
    safety: 3,
    tone: 3,
    overall: 3,
    dimensionNotes: {},
    note: input.note,
    annotator: input.annotator,
    createdAt: now,
    updatedAt: now,
  };
  await updateCollection('annotations', (current) => [annotation, ...current]);
  return annotation;
}

export async function markRunHandoff(input: {
  runId: string;
  reason: string;
  by: string;
}): Promise<Run> {
  return updateRun(input.runId, (run) => {
    const handoff: AgentHandoff = {
      status: '已接管',
      reason: input.reason,
      by: input.by,
      at: new Date().toISOString(),
    };
    return {
      ...run,
      handoff,
      status: '转人工',
    };
  });
}
