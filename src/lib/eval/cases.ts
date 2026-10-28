import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { readCollection, updateCollection } from '@/lib/store';
import type { EvalCase, Run } from '@/lib/schemas';
import { getRun } from '@/lib/agent/runs';
import { deriveQuestionType } from '@/lib/ops/rules';

const capabilityList = z.array(z.string().trim().min(1).max(160)).max(50);
const tags = z.array(z.string().trim().min(1).max(80)).max(30);

export const evalCaseCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    question: z.string().trim().min(1).max(4000),
    scenario: z.string().trim().min(1).max(120).optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
    riskLevel: z.enum(['none', 'low', 'medium', 'high']).optional(),
    expectedReply: z.string().trim().max(8000).optional(),
    expectedKeywords: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
    keywordMode: z.enum(['AND', 'OR']).optional(),
    forbiddenWords: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
    expectedPrice: z.number().min(0).max(1_000_000).nullable().optional(),
    expectRiskPassed: z.boolean().optional(),
    requiredCapabilities: capabilityList.optional(),
    forbiddenCapabilities: capabilityList.optional(),
    expectedToolFacts: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
    maxLatencyMs: z.number().int().min(100).max(120000).optional(),
    humanScores: z
      .object({
        correctness: z.number().int().min(1).max(5),
        relevance: z.number().int().min(1).max(5),
        completeness: z.number().int().min(1).max(5),
        safety: z.number().int().min(1).max(5),
        tone: z.number().int().min(1).max(5),
        overall: z.number().int().min(1).max(5),
      })
      .nullable()
      .optional(),
    evalDimension: z.enum(['correctness', 'relevance', 'completeness', 'safety', 'tone', 'overall']).optional(),
    llmJudgePrompt: z.string().trim().max(8000).optional(),
    tags: tags.optional(),
    sourceRunId: z.string().trim().min(1).max(160).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const evalCaseUpdateSchema = evalCaseCreateSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少需要一个评测用例更新字段',
  });

export const evalCaseFromRunSchema = z
  .object({
    runId: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

function makeCase(input: {
  name: string;
  question: string;
  scenario?: string;
  difficulty?: EvalCase['difficulty'];
  riskLevel?: EvalCase['riskLevel'];
  expectedReply?: string;
  expectedKeywords?: string[];
  keywordMode?: EvalCase['keywordMode'];
  forbiddenWords?: string[];
  expectedPrice?: number | null;
  expectRiskPassed?: boolean;
  requiredCapabilities?: string[];
  forbiddenCapabilities?: string[];
  expectedToolFacts?: string[];
  maxLatencyMs?: number;
  humanScores?: EvalCase['humanScores'];
  evalDimension?: EvalCase['evalDimension'];
  llmJudgePrompt?: string;
  tags?: string[];
  sourceRunId?: string | null;
  enabled?: boolean;
}): EvalCase {
  const now = new Date().toISOString();
  return {
    id: `eval-${Date.now()}-${randomUUID().slice(0, 6)}`,
    name: input.name,
    question: input.question,
    scenario: input.scenario ?? deriveQuestionType(input.question),
    difficulty: input.difficulty ?? 'medium',
    riskLevel: input.riskLevel ?? 'low',
    expectedReply: input.expectedReply ?? '',
    expectedKeywords: input.expectedKeywords ?? [],
    keywordMode: input.keywordMode ?? 'AND',
    forbiddenWords: input.forbiddenWords ?? [],
    expectedPrice: input.expectedPrice ?? null,
    expectRiskPassed: input.expectRiskPassed ?? true,
    requiredCapabilities: input.requiredCapabilities ?? [],
    forbiddenCapabilities: input.forbiddenCapabilities ?? [],
    expectedToolFacts: input.expectedToolFacts ?? [],
    maxLatencyMs: input.maxLatencyMs ?? 3000,
    humanScores: input.humanScores ?? null,
    evalDimension: input.evalDimension ?? 'overall',
    llmJudgePrompt: input.llmJudgePrompt ?? '',
    tags: input.tags ?? [],
    sourceRunId: input.sourceRunId ?? null,
    createdAt: now,
    enabled: input.enabled ?? true,
  };
}

export async function listEvalCases(): Promise<EvalCase[]> {
  const cases = await readCollection('eval_cases');
  return [...cases].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getEvalCase(id: string): Promise<EvalCase> {
  const cases = await readCollection('eval_cases');
  const found = cases.find((item) => item.id === id);
  if (!found) throw new AppError(404, 'EVAL_CASE_NOT_FOUND', '评测用例不存在');
  return found;
}

export async function createEvalCase(raw: unknown): Promise<EvalCase> {
  const input = evalCaseCreateSchema.parse(raw);
  const evalCase = makeCase(input);
  await updateCollection('eval_cases', (current) => [evalCase, ...current]);
  return evalCase;
}

export async function updateEvalCase(id: string, raw: unknown): Promise<EvalCase> {
  const input = evalCaseUpdateSchema.parse(raw);
  let updated: EvalCase | null = null;
  await updateCollection('eval_cases', (current) => {
    const existing = current.find((item) => item.id === id);
    if (!existing) throw new AppError(404, 'EVAL_CASE_NOT_FOUND', '评测用例不存在');
    updated = {
      ...existing,
      ...input,
    };
    return current.map((item) => (item.id === id ? updated! : item));
  });
  if (!updated) throw new AppError(404, 'EVAL_CASE_NOT_FOUND', '评测用例不存在');
  return updated;
}

export async function deleteEvalCase(id: string): Promise<void> {
  let removed = false;
  await updateCollection('eval_cases', (current) => {
    const next = current.filter((item) => item.id !== id);
    removed = next.length !== current.length;
    if (!removed) throw new AppError(404, 'EVAL_CASE_NOT_FOUND', '评测用例不存在');
    return next;
  });
}

export async function copyEvalCase(id: string): Promise<EvalCase> {
  const source = await getEvalCase(id);
  const copy = makeCase({
    ...source,
    name: `${source.name}（副本）`,
    enabled: false,
    tags: [...source.tags, 'copy'],
  });
  await updateCollection('eval_cases', (current) => [copy, ...current]);
  return copy;
}

export async function createCaseFromRun(raw: unknown): Promise<EvalCase> {
  const input = evalCaseFromRunSchema.parse(raw);
  const run = await getRun(input.runId);
  const evalCase = makeCase({
    name: input.name ?? `Run 回归：${run.question.slice(0, 60)}`,
    question: run.question,
    scenario: deriveQuestionType(run.question),
    difficulty: 'medium',
    riskLevel: run.riskResult?.riskLevel ?? 'low',
    expectedReply: '',
    expectedKeywords: [],
    keywordMode: 'AND',
    forbiddenWords: [],
    expectedPrice: null,
    expectRiskPassed: true,
    requiredCapabilities: [
      ...(run.plan?.selectedSkills ?? []).map((id) => `skill:${id}`),
      ...(run.plan?.selectedTools ?? []).map((id) => `tool:${id}`),
    ],
    forbiddenCapabilities: [],
    evalDimension: 'overall',
    llmJudgePrompt: '',
    tags: ['from-run'],
    sourceRunId: run.id,
    enabled: true,
  });
  await updateCollection('eval_cases', (current) => [evalCase, ...current]);
  return evalCase;
}

export function evalCaseFromRunInput(run: Run, name?: string): EvalCase {
  return {
    ...makeCase({
      name: name ?? `Run 回归：${run.question.slice(0, 60)}`,
      question: run.question,
      scenario: deriveQuestionType(run.question),
      difficulty: 'medium',
      riskLevel: run.riskResult?.riskLevel ?? 'low',
      requiredCapabilities: [
        ...(run.plan?.selectedSkills ?? []).map((id) => `skill:${id}`),
        ...(run.plan?.selectedTools ?? []).map((id) => `tool:${id}`),
      ],
      tags: ['from-run'],
      sourceRunId: run.id,
    }),
  };
}
