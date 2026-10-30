import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { readCollection, updateCollection } from '@/lib/store';
import type { Annotation, EvalCase, Improvement, Run } from '@/lib/schemas';
import { getRun } from '@/lib/agent/runs';
import { deriveQuestionType, inferImprovementDirection } from './rules';

const score = z.number().int().min(1).max(5);
const target = z.enum(['run', 'reply']);

export const annotationCreateSchema = z
  .object({
    runId: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1, '标注标签不能为空').max(120),
    target: target.optional(),
    status: z.enum(['pending', 'accepted', 'rejected', 'evaluating']).optional(),
    origin: z.enum([
      'manual',
      'bad-case',
      'low-rating',
      'low-annotation',
      'run-followup',
      'bad-case-evaluation',
      'low-rating-evaluation',
      'low-annotation-evaluation',
      'run-followup-evaluation',
    ]).optional(),
    correctness: score.optional(),
    relevance: score.optional(),
    completeness: score.optional(),
    safety: score.optional(),
    tone: score.optional(),
    overall: score.optional(),
    note: z.string().trim().max(3000).optional(),
    annotator: z.string().trim().min(1).max(80).optional(),
    question: z.string().trim().max(4000).optional(),
    answer: z.string().trim().max(8000).optional(),
    expectedReply: z.string().trim().max(8000).optional(),
    intent: z.string().trim().max(120).optional(),
    riskLevel: z.enum(['none', 'low', 'medium', 'high']).optional(),
    qualityTags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    requiredCapabilities: z.array(z.string().trim().min(1).max(160)).max(30).optional(),
    requiredSkills: z.array(z.string().trim().min(1).max(160)).max(30).optional(),
    expectedFacts: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
    expectedToolFacts: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
    forbiddenPhrases: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
    failureReason: z.string().trim().max(3000).optional(),
    dimensionNotes: z.record(z.string(), z.string().max(1000)).optional(),
  })
  .strict();

export const annotationUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    target: target.optional(),
    status: z.enum(['pending', 'accepted', 'rejected', 'evaluating']).optional(),
    origin: z.enum([
      'manual',
      'bad-case',
      'low-rating',
      'low-annotation',
      'run-followup',
      'bad-case-evaluation',
      'low-rating-evaluation',
      'low-annotation-evaluation',
      'run-followup-evaluation',
    ]).optional(),
    correctness: score.optional(),
    relevance: score.optional(),
    completeness: score.optional(),
    safety: score.optional(),
    tone: score.optional(),
    overall: score.optional(),
    note: z.string().trim().max(3000).optional(),
    question: z.string().trim().max(4000).optional(),
    answer: z.string().trim().max(8000).optional(),
    expectedReply: z.string().trim().max(8000).optional(),
    intent: z.string().trim().max(120).optional(),
    riskLevel: z.enum(['none', 'low', 'medium', 'high']).optional(),
    qualityTags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    requiredCapabilities: z.array(z.string().trim().min(1).max(160)).max(30).optional(),
    requiredSkills: z.array(z.string().trim().min(1).max(160)).max(30).optional(),
    expectedFacts: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
    expectedToolFacts: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
    forbiddenPhrases: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
    failureReason: z.string().trim().max(3000).optional(),
    dimensionNotes: z.record(z.string(), z.string().max(1000)).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要一个标注更新字段',
  });

export const annotationPromoteSchema = z
  .object({ target: z.enum(['improvement', 'eval']) })
  .strict();

export type AnnotationFilters = {
  status?: string;
  target?: string;
  origin?: string;
  runId?: string;
  from?: string;
  to?: string;
};

function requireAnnotation(id: string, annotations: Annotation[]): Annotation {
  const annotation = annotations.find((item) => item.id === id);
  if (!annotation) {
    throw new AppError(404, 'ANNOTATION_NOT_FOUND', '标注不存在');
  }
  return annotation;
}

function filterAnnotations(
  annotations: Annotation[],
  filters: AnnotationFilters,
): Annotation[] {
  const from = filters.from ? new Date(filters.from).getTime() : null;
  const to = filters.to ? new Date(filters.to).getTime() : null;
  return annotations
    .filter((annotation) => {
      if (filters.status && annotation.status !== filters.status) return false;
      if (filters.target && annotation.target !== filters.target) return false;
      if (filters.origin && annotation.origin !== filters.origin) return false;
      if (filters.runId && annotation.runId !== filters.runId) return false;
      const created = new Date(annotation.createdAt).getTime();
      if (from !== null && created < from) return false;
      if (to !== null && created > to) return false;
      return true;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function requiredCapabilitiesFor(run: Run): string[] {
  return [
    ...(run.plan?.selectedSkills ?? []).map((id) => `skill:${id}`),
    ...(run.plan?.selectedTools ?? []).map((id) => `tool:${id}`),
  ];
}

function requiredSkillsFor(run: Run): string[] {
  return (run.plan?.selectedSkills ?? []).map((id) => `skill:${id}`);
}

const AUTO_ORIGINS = new Set<Annotation['origin']>([
  'bad-case',
  'low-rating',
  'low-annotation',
  'run-followup',
]);

function baseOrigin(origin: Annotation['origin']): Annotation['origin'] {
  if (origin === 'bad-case-evaluation') return 'bad-case';
  if (origin === 'low-rating-evaluation') return 'low-rating';
  if (origin === 'low-annotation-evaluation') return 'low-annotation';
  if (origin === 'run-followup-evaluation') return 'run-followup';
  return origin;
}

function savedOrigin(origin: Annotation['origin']): Annotation['origin'] {
  if (origin === 'bad-case') return 'bad-case-evaluation';
  if (origin === 'low-rating') return 'low-rating-evaluation';
  if (origin === 'low-annotation') return 'low-annotation-evaluation';
  if (origin === 'run-followup') return 'run-followup-evaluation';
  return origin;
}

function automaticAnnotation(input: {
  run: Run;
  origin: Annotation['origin'];
  sourceId: string;
  label: string;
  failureReason: string;
  question?: string;
  answer?: string;
  expectedReply?: string;
  intent?: string;
  qualityTags?: string[];
  requiredSkills?: string[];
  expectedToolFacts?: string[];
  forbiddenPhrases?: string[];
  note?: string;
}): Annotation {
  const now = new Date().toISOString();
  return {
    id: `ann-${Date.now()}-${randomUUID().slice(0, 6)}`,
    runId: input.run.id,
    target: 'reply',
    label: input.label,
    status: 'evaluating',
    origin: input.origin,
    sourceId: input.sourceId,
    question: input.question ?? input.run.question,
    answer: input.answer ?? input.run.finalReply ?? '',
    expectedReply: input.expectedReply ?? '',
    intent: input.intent ?? deriveQuestionType(input.question ?? input.run.question),
    riskLevel: input.run.riskResult?.riskLevel ?? 'none',
    qualityTags: input.qualityTags ?? [],
    requiredCapabilities: requiredCapabilitiesFor(input.run),
    requiredSkills: input.requiredSkills ?? requiredSkillsFor(input.run),
    expectedFacts: [],
    expectedToolFacts: input.expectedToolFacts ?? [],
    forbiddenPhrases: input.forbiddenPhrases ?? [],
    failureReason: input.failureReason,
    correctness: 3,
    relevance: 3,
    completeness: 3,
    safety: 3,
    tone: 3,
    overall: 3,
    dimensionNotes: {},
    note: input.note ?? '',
    annotator: '自动队列',
    createdAt: now,
    updatedAt: now,
  };
}

/** Eval 单条/批次 FAIL 时自动进入人工评估队列。 */
export async function enqueueEvalFailure(input: {
  evalCase: EvalCase;
  run: Run;
  reason: string;
}): Promise<{ created: boolean; annotation: Annotation | null }> {
  const { evalCase, run, reason } = input;
  let created = false;
  let annotation: Annotation | null = null;
  await updateCollection('annotations', (current) => {
    const existing = current.find(
      (item) => item.runId === run.id && baseOrigin(item.origin) === 'bad-case',
    );
    if (existing) {
      annotation = existing;
      return current;
    }
    const now = new Date().toISOString();
    annotation = {
      id: `ann-${Date.now()}-${randomUUID().slice(0, 6)}`,
      runId: run.id,
      target: 'reply',
      label: `Eval Bad Case · ${evalCase.name}`,
      status: 'evaluating',
      origin: 'bad-case-evaluation',
      sourceId: run.id,
      question: evalCase.question,
      answer: run.finalReply ?? '',
      expectedReply: evalCase.expectedReply,
      intent: deriveQuestionType(evalCase.question),
      riskLevel: run.riskResult?.riskLevel ?? evalCase.riskLevel,
      qualityTags: ['Eval FAIL', ...evalCase.tags],
      requiredCapabilities:
        evalCase.requiredCapabilities.length > 0
          ? evalCase.requiredCapabilities
          : requiredCapabilitiesFor(run),
      requiredSkills: requiredSkillsFor(run),
      expectedFacts: [],
      expectedToolFacts: evalCase.expectedToolFacts,
      forbiddenPhrases: evalCase.forbiddenWords,
      failureReason: reason,
      correctness: 3,
      relevance: 3,
      completeness: 3,
      safety: 3,
      tone: 3,
      overall: 3,
      dimensionNotes: {},
      note: `Eval 用例 ${evalCase.id} 执行失败，自动进入人工评估。`,
      annotator: '自动队列',
      createdAt: now,
      updatedAt: now,
    };
    created = true;
    return [annotation, ...current];
  });
  return { created, annotation };
}

/**
 * 人工评估队列：
 * - 失败 Run Bad Case
 * - 低评分服务
 * - 低分标注
 * - Run 标注人工跟进
 * 旧版自动标注（pending）会迁移到 evaluating；保存为标注后变为 pending。
 */
export async function ensureEvaluationQueue(): Promise<{ created: number; migrated: number }> {
  const [runs, ratings, annotations] = await Promise.all([
    readCollection('runs'),
    readCollection('ratings'),
    readCollection('annotations'),
  ]);
  const runMap = new Map(runs.map((run) => [run.id, run]));
  const candidates: Annotation[] = [];

  for (const run of runs) {
    if (run.status !== '失败' && run.evaluation?.status !== 'FAIL') continue;
    const failed = run.steps.find((step) => step.status === 'ERROR');
    candidates.push(
      automaticAnnotation({
        run,
        origin: 'bad-case',
        sourceId: run.id,
        label: 'Bad Case 人工评估',
        failureReason:
          run.errorCode ??
          failed?.error ??
          `evaluation ${run.evaluation?.status ?? 'FAIL'}`,
        qualityTags: ['Bad Case'],
      }),
    );
  }

  for (const rating of ratings) {
    if (rating.score > 2) continue;
    const run = runMap.get(rating.runId);
    if (!run) continue;
    candidates.push(
      automaticAnnotation({
        run,
        origin: 'low-rating',
        sourceId: rating.id,
        label: '低评分人工评估',
        failureReason: `用户评分 ${rating.score} 分${rating.comment ? `：${rating.comment}` : ''}`,
        question: rating.question || run.question,
        answer: rating.answer || run.finalReply || '',
        expectedReply: '',
        qualityTags: ['低评分'],
      }),
    );
  }

  for (const annotation of annotations) {
    if (annotation.overall > 2 && annotation.status !== 'rejected') continue;
    const run = runMap.get(annotation.runId);
    if (!run) continue;
    candidates.push(
      automaticAnnotation({
        run,
        origin: 'low-annotation',
        sourceId: annotation.id,
        label: '低分标注人工评估',
        failureReason: `标注 overall=${annotation.overall}/5，status=${annotation.status}${annotation.note ? `：${annotation.note}` : ''}`,
        question: annotation.question || run.question,
        answer: annotation.answer || run.finalReply || '',
        expectedReply: annotation.expectedReply,
        intent: annotation.intent,
        qualityTags: annotation.qualityTags,
        requiredSkills: annotation.requiredSkills,
        expectedToolFacts: annotation.expectedToolFacts,
        forbiddenPhrases: annotation.forbiddenPhrases,
        note: annotation.note,
      }),
    );
  }

  for (const annotation of annotations.filter((item) => item.origin === 'manual')) {
    const run = runMap.get(annotation.runId);
    if (!run) continue;
    candidates.push(
      automaticAnnotation({
        run,
        origin: 'run-followup',
        sourceId: annotation.id,
        label: 'Run 标注人工跟进',
        failureReason: annotation.failureReason || annotation.note || 'Run 标注需要人工跟进',
        question: annotation.question || run.question,
        answer: annotation.answer || run.finalReply || '',
        expectedReply: annotation.expectedReply,
        intent: annotation.intent,
        qualityTags: annotation.qualityTags,
        requiredSkills: annotation.requiredSkills,
        expectedToolFacts: annotation.expectedToolFacts,
        forbiddenPhrases: annotation.forbiddenPhrases,
        note: annotation.note,
      }),
    );
  }

  let created = 0;
  let migrated = 0;
  await updateCollection('annotations', (current) => {
    const now = new Date().toISOString();
    const migratedCurrent = current.map((annotation) => {
      if (AUTO_ORIGINS.has(annotation.origin) && annotation.status === 'pending') {
        migrated += 1;
        return { ...annotation, status: 'evaluating' as const, updatedAt: now };
      }
      return annotation;
    });
    const existing = new Set(
      migratedCurrent
        .filter((annotation) => annotation.sourceId)
        .map((annotation) => `${baseOrigin(annotation.origin)}:${annotation.sourceId}`),
    );
    const fresh = candidates.filter((candidate) => {
      const key = `${baseOrigin(candidate.origin)}:${candidate.sourceId}`;
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    created = fresh.length;
    return fresh.length === 0 ? migratedCurrent : [...fresh, ...migratedCurrent];
  });
  return { created, migrated };
}

export async function listAnnotations(
  filters: AnnotationFilters = {},
): Promise<Annotation[]> {
  await ensureEvaluationQueue();
  const [annotations, runs] = await Promise.all([
    readCollection('annotations'),
    readCollection('runs'),
  ]);
  const runMap = new Map(runs.map((run) => [run.id, run]));
  const enriched = annotations.map((annotation) => {
    const run = runMap.get(annotation.runId);
    if (!run) return annotation;
    return {
      ...annotation,
      question: annotation.question || run.question,
      answer: annotation.answer || run.finalReply || '',
      intent:
        annotation.intent && annotation.intent !== '未分类'
          ? annotation.intent
          : deriveQuestionType(run.question),
      riskLevel:
        annotation.riskLevel && annotation.riskLevel !== 'none'
          ? annotation.riskLevel
          : run.riskResult?.riskLevel ?? 'none',
      requiredCapabilities:
        annotation.requiredCapabilities.length > 0
          ? annotation.requiredCapabilities
          : requiredCapabilitiesFor(run),
      requiredSkills:
        annotation.requiredSkills.length > 0
          ? annotation.requiredSkills
          : requiredSkillsFor(run),
    };
  });
  return filterAnnotations(enriched, filters);
}

export async function saveEvaluationAsAnnotation(id: string): Promise<Annotation> {
  const annotation = await getAnnotation(id);
  if (annotation.status !== 'evaluating') {
    throw new AppError(409, 'EVALUATION_NOT_PENDING', '只有人工评估中的记录可以保存为标注');
  }
  return updateAnnotation(id, {
    status: 'pending',
    origin: savedOrigin(annotation.origin),
  });
}

export async function exportAnnotationsJsonl(
  filters: AnnotationFilters = {},
  scope: 'review' | 'all' = 'all',
): Promise<{ jsonl: string; count: number }> {
  const effectiveFilters = scope === 'review' ? { ...filters, status: 'pending' } : filters;
  const annotations = await listAnnotations(effectiveFilters);
  return {
    jsonl: annotations.map((annotation) => JSON.stringify(annotation)).join('\n') + (annotations.length > 0 ? '\n' : ''),
    count: annotations.length,
  };
}

export const annotationImportSchema = z
  .object({
    items: z
      .array(
        z.object({
          runId: z.string().trim().min(1).max(160),
          label: z.string().trim().min(1).max(120).optional(),
          question: z.string().trim().max(4000).optional(),
          answer: z.string().trim().max(8000).optional(),
          expectedReply: z.string().trim().max(8000).optional(),
          intent: z.string().trim().max(120).optional(),
          qualityTags: z.array(z.string()).max(30).optional(),
          requiredSkills: z.array(z.string()).max(30).optional(),
          expectedToolFacts: z.array(z.string()).max(30).optional(),
          forbiddenPhrases: z.array(z.string()).max(30).optional(),
          failureReason: z.string().trim().max(3000).optional(),
          note: z.string().trim().max(3000).optional(),
          annotator: z.string().trim().max(80).optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();

export async function importBadCases(raw: unknown): Promise<{ created: number }> {
  const input = annotationImportSchema.parse(raw);
  const now = new Date().toISOString();
  const imported: Annotation[] = [];
  for (const [index, item] of input.items.entries()) {
    const run = await getRun(item.runId);
    imported.push({
      id: `ann-${Date.now()}-${randomUUID().slice(0, 6)}-${index}`,
      runId: run.id,
      target: 'reply',
      label: item.label ?? '导入 Bad Case',
      status: 'pending',
      origin: 'bad-case-evaluation',
      sourceId: `import-${Date.now()}-${index}`,
      question: item.question ?? run.question,
      answer: item.answer ?? run.finalReply ?? '',
      expectedReply: item.expectedReply ?? '',
      intent: item.intent ?? deriveQuestionType(item.question ?? run.question),
      riskLevel: run.riskResult?.riskLevel ?? 'none',
      qualityTags: item.qualityTags ?? ['导入 Bad Case'],
      requiredCapabilities: requiredCapabilitiesFor(run),
      requiredSkills: item.requiredSkills ?? requiredSkillsFor(run),
      expectedFacts: [],
      expectedToolFacts: item.expectedToolFacts ?? [],
      forbiddenPhrases: item.forbiddenPhrases ?? [],
      failureReason: item.failureReason ?? '通过 JSONL / JSON 导入的 Bad Case',
      correctness: 3,
      relevance: 3,
      completeness: 3,
      safety: 3,
      tone: 3,
      overall: 3,
      dimensionNotes: {},
      note: item.note ?? '',
      annotator: item.annotator ?? '运营导入',
      createdAt: now,
      updatedAt: now,
    });
  }
  await updateCollection('annotations', (current) => [...imported, ...current]);
  return { created: imported.length };
}

export async function getAnnotation(id: string): Promise<Annotation> {
  const annotations = await readCollection('annotations');
  return requireAnnotation(id, annotations);
}

export async function createAnnotation(raw: unknown): Promise<Annotation> {
  const input = annotationCreateSchema.parse(raw);
  const run = await getRun(input.runId);
  const now = new Date().toISOString();
  const annotation: Annotation = {
    id: `ann-${Date.now()}-${randomUUID().slice(0, 6)}`,
    runId: run.id,
    target: input.target ?? 'run',
    label: input.label,
    status: input.status ?? 'pending',
    origin: 'manual',
    question: input.question ?? run.question,
    answer: input.answer ?? run.finalReply ?? '',
    expectedReply: input.expectedReply ?? '',
    intent: input.intent ?? deriveQuestionType(input.question ?? run.question),
    riskLevel: input.riskLevel ?? run.riskResult?.riskLevel ?? 'none',
    qualityTags: input.qualityTags ?? [],
    requiredCapabilities:
      input.requiredCapabilities ??
      [
        ...(run.plan?.selectedSkills ?? []).map((id) => `skill:${id}`),
        ...(run.plan?.selectedTools ?? []).map((id) => `tool:${id}`),
      ],
    requiredSkills:
      input.requiredSkills ?? (run.plan?.selectedSkills ?? []).map((id) => `skill:${id}`),
    expectedFacts: input.expectedFacts ?? [],
    expectedToolFacts: input.expectedToolFacts ?? [],
    forbiddenPhrases: input.forbiddenPhrases ?? [],
    failureReason: input.failureReason ?? '',
    correctness: input.correctness ?? 3,
    relevance: input.relevance ?? 3,
    completeness: input.completeness ?? 3,
    safety: input.safety ?? 3,
    tone: input.tone ?? 3,
    overall: input.overall ?? 3,
    dimensionNotes: input.dimensionNotes ?? {},
    note: input.note ?? '',
    annotator: input.annotator ?? '运营管理员',
    createdAt: now,
    updatedAt: now,
  };
  await updateCollection('annotations', (current) => [annotation, ...current]);
  return annotation;
}

export async function updateAnnotation(
  id: string,
  raw: unknown,
): Promise<Annotation> {
  const input = annotationUpdateSchema.parse(raw);
  let updated: Annotation | null = null;
  await updateCollection('annotations', (current) => {
    const existing = requireAnnotation(id, current);
    updated = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    return current.map((annotation) => (annotation.id === id ? updated! : annotation));
  });
  if (!updated) throw new AppError(404, 'ANNOTATION_NOT_FOUND', '标注不存在');
  return updated;
}

export async function exportAnnotationsCsv(
  filters: AnnotationFilters = {},
): Promise<{ csv: string; count: number }> {
  const annotations = await listAnnotations(filters);
  const headers = [
    'id',
    'runId',
    'origin',
    'sourceId',
    'target',
    'status',
    'label',
    'question',
    'answer',
    'expectedReply',
    'intent',
    'riskLevel',
    'qualityTags',
    'requiredCapabilities',
    'requiredSkills',
    'expectedFacts',
    'expectedToolFacts',
    'forbiddenPhrases',
    'failureReason',
    'correctness',
    'relevance',
    'completeness',
    'safety',
    'tone',
    'overall',
    'dimensionNotes',
    'annotator',
    'createdAt',
    'updatedAt',
    'note',
  ];
  const escape = (value: unknown): string => {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = annotations.map((annotation) =>
    [
      annotation.id,
      annotation.runId,
      annotation.origin,
      annotation.sourceId ?? '',
      annotation.target,
      annotation.status,
      annotation.label,
      annotation.question,
      annotation.answer,
      annotation.expectedReply,
      annotation.intent,
      annotation.riskLevel,
      annotation.qualityTags.join('|'),
      annotation.requiredCapabilities.join('|'),
      annotation.requiredSkills.join('|'),
      annotation.expectedFacts.join('|'),
      annotation.expectedToolFacts.join('|'),
      annotation.forbiddenPhrases.join('|'),
      annotation.failureReason,
      annotation.correctness,
      annotation.relevance,
      annotation.completeness,
      annotation.safety,
      annotation.tone,
      annotation.overall,
      JSON.stringify(annotation.dimensionNotes),
      annotation.annotator,
      annotation.createdAt,
      annotation.updatedAt ?? '',
      annotation.note,
    ]
      .map(escape)
      .join(','),
  );
  return {
    csv: `\uFEFF${headers.join(',')}\n${rows.join('\n')}\n`,
    count: annotations.length,
  };
}

export async function promoteAnnotation(
  id: string,
  raw: unknown,
): Promise<{
  annotation: Annotation;
  improvement?: Improvement;
  evalCase?: EvalCase;
}> {
  const input = annotationPromoteSchema.parse(raw);
  const annotation = await getAnnotation(id);
  if (annotation.status !== 'accepted') {
    throw new AppError(
      409,
      'ANNOTATION_NOT_ACCEPTED',
      '只有已接受的标注才能进入改进建议或评测集',
    );
  }
  const run = await getRun(annotation.runId);
  const now = new Date().toISOString();
  const accepted = annotation;

  if (input.target === 'improvement' && annotation.promotedImprovementId) {
    const improvements = await readCollection('improvements');
    const existing = improvements.find((item) => item.id === annotation.promotedImprovementId);
    if (existing) return { annotation, improvement: existing };
  }
  if (input.target === 'eval' && annotation.promotedEvalCaseId) {
    const cases = await readCollection('eval_cases');
    const existing = cases.find((item) => item.id === annotation.promotedEvalCaseId);
    if (existing) return { annotation, evalCase: existing };
  }

  if (input.target === 'improvement') {
    const direction = inferImprovementDirection(run);
    const lowOverall = annotation.overall <= 2;
    const improvement: Improvement = {
      id: `improvement-${Date.now()}-${randomUUID().slice(0, 6)}`,
      title: `标注改进：${annotation.label}`,
      source: `标注 ${annotation.id} · Run ${run.id}`,
      sourceType: 'low-annotation',
      direction,
      description: `人工标注 overall=${annotation.overall}，${annotation.note || '无备注'}`,
      ruleCluster: false,
      sampleRunIds: [run.id],
      suggestedAction: `根据标注结果优先检查 ${direction} 配置，并复核该 Run。`,
      priority: lowOverall ? '高' : '中',
      status: '待处理',
      owner: '待分配',
      createdAt: now,
      updatedAt: now,
    };
    await updateCollection('improvements', (current) => [improvement, ...current]);
    const updated = await updateCollection('annotations', (current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, promotedImprovementId: improvement.id, promotedAt: now }
          : item,
      ),
    );
    const updatedAnnotation = updated.find((item) => item.id === id) ?? accepted;
    return { annotation: updatedAnnotation, improvement };
  }

  const evalCase: EvalCase = {
    id: `eval-${Date.now()}-${randomUUID().slice(0, 6)}`,
    name: `标注用例：${annotation.label}`,
    question: run.question,
    scenario: deriveQuestionType(run.question),
    difficulty: 'medium',
    riskLevel: run.riskResult?.riskLevel ?? 'low',
    expectedReply: annotation.expectedReply,
    expectedKeywords: annotation.expectedToolFacts,
    keywordMode: 'AND',
    forbiddenWords: annotation.forbiddenPhrases,
    expectedPrice: null,
    expectRiskPassed: annotation.riskLevel !== 'high',
    requiredCapabilities: [
      ...(run.plan?.selectedSkills ?? []).map((id) => `skill:${id}`),
      ...(run.plan?.selectedTools ?? []).map((id) => `tool:${id}`),
    ],
    forbiddenCapabilities: [],
    expectedToolFacts: annotation.expectedToolFacts,
    maxLatencyMs: 3000,
    humanScores: {
      correctness: annotation.correctness,
      relevance: annotation.relevance,
      completeness: annotation.completeness,
      safety: annotation.safety,
      tone: annotation.tone,
      overall: annotation.overall,
    },
    evalDimension: 'overall',
    llmJudgePrompt: '',
    tags: ['from-annotation', `annotation:${annotation.id}`, annotation.label],
    sourceRunId: run.id,
    createdAt: now,
    enabled: true,
  };
  await updateCollection('eval_cases', (current) => [evalCase, ...current]);
  const updated = await updateCollection('annotations', (current) =>
    current.map((item) =>
      item.id === id
        ? { ...item, promotedEvalCaseId: evalCase.id, promotedAt: now }
        : item,
    ),
  );
  const updatedAnnotation = updated.find((item) => item.id === id) ?? accepted;
  return { annotation: updatedAnnotation, evalCase };
}

export function annotationRunLink(annotation: Annotation): string {
  return `/runs/${annotation.runId}`;
}

export function annotationSummary(annotation: Annotation, run?: Run): string {
  return `${annotation.label} · ${annotation.status} · overall ${annotation.overall}/5${
    run ? ` · ${run.question}` : ''
  }`;
}
