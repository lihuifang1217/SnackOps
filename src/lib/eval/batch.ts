import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { readCollection, updateCollection } from '@/lib/store';
import type { AgentProviderSelection, EvalBatch, EvalBatchCaseResult } from '@/lib/types';
import type { EvalCase, Run } from '@/lib/schemas';
import { prepareAgentRun, runPreparedAgent } from '@/lib/agent/service';
import { listEvalCases } from './cases';
import { scoreEvalCaseDetailed } from './detailed-score';
import { getEvalConfig } from './config';
import { judgeEvalCase } from './judge';
import { enqueueEvalFailure } from '@/lib/ops/annotations';

const providerSelection = z
  .enum(['auto', 'classroom-fixture', 'openai-compatible', 'coze'])
  .optional();

export const batchRunSchema = z
  .object({
    caseIds: z.array(z.string().trim().min(1).max(160)).optional(),
    name: z.string().trim().min(1).max(160).optional(),
    versionLabel: z.string().trim().min(1).max(80).optional(),
    changeNote: z.string().trim().max(2000).optional(),
    provider: providerSelection,
  })
  .strict();

export const EVALUATOR_VERSION = 'eval-scorer.v1';
export const EVALUATOR_HASH = createHash('sha256')
  .update(`${EVALUATOR_VERSION}:snackops-eval-scorer`)
  .digest('hex');

function caseSetHash(cases: EvalCase[]): string {
  const canonical = cases.map((item) => ({
    id: item.id,
    name: item.name,
    question: item.question,
    scenario: item.scenario,
    difficulty: item.difficulty,
    riskLevel: item.riskLevel,
    expectedReply: item.expectedReply,
    expectedKeywords: item.expectedKeywords,
    keywordMode: item.keywordMode,
    forbiddenWords: item.forbiddenWords,
    expectedPrice: item.expectedPrice,
    expectRiskPassed: item.expectRiskPassed,
    requiredCapabilities: item.requiredCapabilities,
    forbiddenCapabilities: item.forbiddenCapabilities,
    evalDimension: item.evalDimension,
    llmJudgePrompt: item.llmJudgePrompt,
  }));
  return createHash('sha256')
    .update(JSON.stringify({ evaluator: EVALUATOR_VERSION, cases: canonical }))
    .digest('hex');
}

function versionSummary(runs: Run[]): { versions: Run['skillVersions']; version: string; hash: string } {
  const byId = new Map<string, { skillId: string; version: string; hash: string }>();
  for (const run of runs) {
    for (const skill of run.skillVersions) {
      byId.set(skill.skillId, skill);
    }
  }
  const versions = [...byId.values()].sort((left, right) => left.skillId.localeCompare(right.skillId));
  return {
    versions,
    version: versions.map((item) => `${item.skillId}@${item.version}`).join(' | ') || '—',
    hash: createHash('sha256').update(JSON.stringify(versions)).digest('hex'),
  };
}

async function updateBatch(
  id: string,
  update: (batch: EvalBatch) => EvalBatch,
): Promise<EvalBatch> {
  let updated: EvalBatch | null = null;
  await updateCollection('eval_batches', (current) => {
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) throw new AppError(404, 'EVAL_BATCH_NOT_FOUND', '评测批次不存在');
    updated = update(current[index]);
    return current.map((item, itemIndex) => (itemIndex === index ? updated! : item));
  });
  if (!updated) throw new AppError(404, 'EVAL_BATCH_NOT_FOUND', '评测批次不存在');
  return updated;
}

async function runBatch(batchId: string): Promise<void> {
  let cancelled = false;
  try {
    let batch = await updateBatch(batchId, (current) => ({
      ...current,
      status: 'running',
      startedAt: new Date().toISOString(),
    }));
    const cases = batch.caseSnapshot;
    const config = await getEvalConfig();
    const completedRuns: Run[] = [];
    let provider = batch.provider;
    let model = batch.model;
    let passed = 0;
    let failed = 0;
    let review = 0;
    let errors = 0;

    for (let index = 0; index < cases.length; index += 1) {
      const currentBatch = await readBatch(batchId);
      if (currentBatch.status === 'cancelled') {
        cancelled = true;
        break;
      }
      const evalCase = cases[index];
      let result: EvalBatchCaseResult;
      try {
        const prepared = await prepareAgentRun({
          request: {
            userInput: evalCase.question,
            source: 'api',
            provider: (batch.params.provider as AgentProviderSelection | undefined) ?? 'auto',
          },
          source: 'api',
          providerSelection: (batch.params.provider as AgentProviderSelection | undefined) ?? 'auto',
        });
        const run = await runPreparedAgent(prepared);
        completedRuns.push(run);
        provider = run.provider;
        model = run.model;
        const judge = await judgeEvalCase({ evalCase, run, config });
        const score = scoreEvalCaseDetailed({ evalCase, run, judge });
        result = {
          caseId: evalCase.id,
          caseName: evalCase.name,
          question: evalCase.question,
          status: score.status,
          finalReply: run.finalReply,
          reason: score.reason,
          runId: run.id,
          durationMs: score.durationMs,
          error: run.error,
          score,
        };
        if (score.status === 'FAIL') {
          await enqueueEvalFailure({ evalCase, run, reason: score.reason });
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : '批次用例执行失败';
        result = {
          caseId: evalCase.id,
          caseName: evalCase.name,
          question: evalCase.question,
          status: 'ERROR',
          finalReply: null,
          reason: message,
          runId: null,
          durationMs: 0,
          error: message,
          score: null,
        };
      }

      if (result.status === 'PASS') passed += 1;
      else if (result.status === 'FAIL') failed += 1;
      else if (result.status === 'REVIEW') review += 1;
      else errors += 1;

      batch = await updateBatch(batchId, (current) => {
        const skill = versionSummary(completedRuns);
        return {
          ...current,
          currentIndex: index + 1,
          passed,
          failed,
          review,
          errors,
          passRate:
            passed + failed + review === 0
              ? 0
              : Math.round((passed / (passed + failed + review)) * 1000) / 10,
          caseResults: [...current.caseResults, result],
          provider,
          model,
          skillVersions: skill.versions,
          skillVersion: skill.version,
          skillHash: skill.hash,
        };
      });
    }

    await updateBatch(batchId, (current) => ({
      ...current,
      status: cancelled ? 'cancelled' : 'done',
      finishedAt: new Date().toISOString(),
      currentIndex: cancelled ? current.currentIndex : cases.length,
    }));
  } catch (caught) {
    try {
      await updateBatch(batchId, (current) => ({
        ...current,
        status: 'error',
        finishedAt: new Date().toISOString(),
        error: caught instanceof Error ? caught.message : '批次执行失败',
      }));
    } catch {
      // 批次记录在极端存储故障下也无法修复，交由 API 读取时展示已有状态。
    }
  }
}

export async function readBatch(id: string): Promise<EvalBatch> {
  const batches = await readCollection('eval_batches');
  const found = batches.find((item) => item.id === id);
  if (!found) throw new AppError(404, 'EVAL_BATCH_NOT_FOUND', '评测批次不存在');
  return found;
}

export async function deleteBatch(id: string): Promise<{ id: string }> {
  let deletedId: string | null = null;
  await updateCollection('eval_batches', (current) => {
    const found = current.find((item) => item.id === id);
    if (!found) throw new AppError(404, 'EVAL_BATCH_NOT_FOUND', '评测批次不存在');
    if (found.status === 'queued' || found.status === 'running') {
      throw new AppError(409, 'EVAL_BATCH_RUNNING', '运行中的批次不能删除，请等待完成或取消后再试');
    }
    deletedId = found.id;
    return current.filter((item) => item.id !== id);
  });
  if (!deletedId) throw new AppError(404, 'EVAL_BATCH_NOT_FOUND', '评测批次不存在');
  return { id: deletedId };
}

export async function createBatch(raw: unknown): Promise<EvalBatch> {
  const input = batchRunSchema.parse(raw);
  const cases = await listEvalCases();
  let selected: EvalCase[];
  if (input.caseIds === undefined) {
    selected = cases.filter((item) => item.enabled);
    if (selected.length === 0) {
      throw new AppError(400, 'NO_ENABLED_EVAL_CASES', '没有启用的评测用例');
    }
  } else {
    if (input.caseIds.length === 0) {
      throw new AppError(400, 'EMPTY_CASE_IDS', 'caseIds 不能为空数组');
    }
    const byId = new Map(cases.map((item) => [item.id, item]));
    const invalidIds = [...new Set(input.caseIds.filter((id) => !byId.has(id)))];
    if (invalidIds.length > 0) {
      throw new AppError(400, 'INVALID_CASE_IDS', '存在无效的 caseIds', { invalidIds });
    }
    const uniqueIds = [...new Set(input.caseIds)];
    selected = uniqueIds.map((id) => byId.get(id)!).filter(Boolean);
  }

  const now = new Date().toISOString();
  const batchId = `eval-batch-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const provider = input.provider ?? 'auto';
  const config = await getEvalConfig();
  const batch: EvalBatch = {
    id: batchId,
    name: input.name ?? `Eval 批次 ${new Date().toLocaleString('zh-CN')}`,
    status: 'queued',
    caseCount: selected.length,
    passRate: 0,
    createdAt: now,
    versionLabel: input.versionLabel ?? `v-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`,
    changeNote: input.changeNote ?? '',
    caseIds: selected.map((item) => item.id),
    caseSnapshot: selected,
    caseSetHash: caseSetHash(selected),
    skillVersions: [],
    skillVersion: '—',
    skillHash: '',
    evaluatorVersion: EVALUATOR_VERSION,
    evaluatorHash: EVALUATOR_HASH,
    provider,
    model: '—',
    params: {
      provider,
      source: 'api',
      judgeEnabled: config.judgeEnabled,
      judgePromptHash: createHash('sha256').update(config.judgeSystemPrompt).digest('hex'),
      judgeTemperature: config.judgeTemperature,
    },
    currentIndex: 0,
    total: selected.length,
    passed: 0,
    failed: 0,
    review: 0,
    errors: 0,
    caseResults: [],
    error: null,
  };
  await updateCollection('eval_batches', (current) => [batch, ...current]);
  void runBatch(batchId);
  return batch;
}
