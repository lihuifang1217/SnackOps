import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { readCollection, updateCollection } from '@/lib/store';
import type { Improvement, Run } from '@/lib/schemas';
import {
  diffLines,
} from '@/lib/registry/diff';
import {
  getSkillDetail,
  saveSkillVersion,
} from '@/lib/registry/skills';
import type {
  ImprovementCenterResponse,
  ImprovementCluster,
  ImprovementDirection,
  OpsSampleRun,
  PromptApplyResponse,
  PromptDraftResponse,
} from '@/lib/types';
import { deriveQuestionType, directionRecommendations, inferImprovementDirection } from './rules';

export const promptDraftRequestSchema = z
  .object({
    improvementId: z.string().trim().min(1).max(160).optional(),
    clusterId: z.string().trim().min(1).max(240).optional(),
    skillId: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.improvementId || value.clusterId), {
    message: '需要 improvementId 或 clusterId',
  });

export const promptApplyRequestSchema = z
  .object({
    improvementId: z.string().trim().min(1).max(160).optional(),
    clusterId: z.string().trim().min(1).max(240).optional(),
    skillId: z.string().trim().min(1).max(80),
    draftPrompt: z.string().min(20).max(50000),
    changeNote: z.string().trim().min(1).max(500),
    expectedHash: z.string().min(16).max(128),
  })
  .strict();


function clusterDirections(primary: ImprovementDirection) {
  return directionRecommendations(primary).map((item) => {
    const separator = item.indexOf('：');
    return {
      direction: item.slice(0, separator) as ImprovementDirection,
      recommendation: item.slice(separator + 1),
    };
  });
}

function directionForRun(run: Run): ImprovementDirection {
  return inferImprovementDirection(run);
}

function sampleFor(run: Run, score?: number): OpsSampleRun {
  return {
    id: run.id,
    question: run.question,
    status: run.status,
    createdAt: run.createdAt,
    ...(score === undefined ? {} : { score }),
  };
}

export async function getImprovementCenter(): Promise<ImprovementCenterResponse> {
  const [runs, ratings, annotations, records, evalBatches] = await Promise.all([
    readCollection('runs'),
    readCollection('ratings'),
    readCollection('annotations'),
    readCollection('improvements'),
    readCollection('eval_batches'),
  ]);
  const runMap = new Map(runs.map((run) => [run.id, run]));
  const buckets = new Map<string, {
    sourceType: ImprovementCluster['sourceType'];
    title: string;
    description: string;
    primaryDirection: ImprovementDirection;
    sampleRunIds: Set<string>;
    sampleRuns: Map<string, OpsSampleRun>;
    count: number;
    priority: '高' | '中' | '低';
  }>();

  const add = (input: {
    key: string;
    sourceType: ImprovementCluster['sourceType'];
    title: string;
    description: string;
    direction: ImprovementDirection;
    run: Run;
    score?: number;
    count?: number;
    priority?: '高' | '中' | '低';
  }) => {
    const current = buckets.get(input.key) ?? {
      sourceType: input.sourceType,
      title: input.title,
      description: input.description,
      primaryDirection: input.direction,
      sampleRunIds: new Set<string>(),
      sampleRuns: new Map<string, OpsSampleRun>(),
      count: 0,
      priority: input.priority ?? '中',
    };
    current.sampleRunIds.add(input.run.id);
    if (!current.sampleRuns.has(input.run.id)) {
      current.sampleRuns.set(input.run.id, sampleFor(input.run, input.score));
    }
    current.count += input.count ?? 1;
    if (input.priority === '高') current.priority = '高';
    buckets.set(input.key, current);
  };

  for (const rating of ratings.filter((item) => item.score <= 2)) {
    const run = runMap.get(rating.runId);
    if (!run) continue;
    const question = rating.question || run.question;
    const type = rating.questionType || deriveQuestionType(question);
    const direction = directionForRun(run);
    add({
      key: `low-rating:${type}:${direction}`,
      sourceType: 'low-rating',
      title: `低评分聚类 · ${type} · ${direction}`,
      description: `规则聚类：按问题类型与低分证据分组；共 ${rating.score} 分评分样本。`,
      direction,
      run,
      score: rating.score,
      priority: rating.score === 1 ? '高' : '中',
    });
  }

  for (const annotation of annotations.filter((item) => item.overall <= 2 || item.status === 'rejected')) {
    const run = runMap.get(annotation.runId);
    if (!run) continue;
    const direction = directionForRun(run);
    add({
      key: `low-annotation:${annotation.label}:${direction}`,
      sourceType: 'low-annotation',
      title: `低分标注聚类 · ${annotation.label} · ${direction}`,
      description: `规则聚类：overall ${annotation.overall}/5，状态 ${annotation.status}。`,
      direction,
      run,
      priority: annotation.overall <= 1 ? '高' : '中',
    });
  }

  for (const run of runs) {
    if (run.status !== '失败' && run.evaluation?.status !== 'FAIL') continue;
    const direction = directionForRun(run);
    add({
      key: `bad-case:${direction}`,
      sourceType: 'bad-case',
      title: `Bad Case 聚类 · ${direction}`,
      description: `规则聚类：${run.status} / evaluation ${run.evaluation?.status ?? '未生成'}，按失败证据归类。`,
      direction,
      run,
      priority: '高',
    });
  }

  const average = (values: number[]): number | null =>
    values.length === 0
      ? null
      : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
  const dimensions = ['correctness', 'relevance', 'completeness', 'safety', 'tone', 'overall'] as const;

  const clusters: ImprovementCluster[] = [...buckets.entries()]
    .map(([id, bucket]) => {
      const sampleRunIds = [...bucket.sampleRunIds];
      const relatedAnnotations = annotations.filter((annotation) =>
        sampleRunIds.includes(annotation.runId),
      );
      const relatedRatings = ratings.filter((rating) => sampleRunIds.includes(rating.runId));
      return {
        id,
        sourceType: bucket.sourceType,
        title: bucket.title,
        description: bucket.description,
        primaryDirection: bucket.primaryDirection,
        directions: clusterDirections(bucket.primaryDirection),
        sampleRunIds,
        sampleRuns: [...bucket.sampleRuns.values()],
        count: bucket.count,
        priority: bucket.priority,
        ruleCluster: true,
        dimensionAverages: Object.fromEntries(
          dimensions.map((dimension) => [
            dimension,
            average(relatedAnnotations.map((annotation) => annotation[dimension])),
          ]),
        ),
        userRatingAverage: average(relatedRatings.map((rating) => rating.score)),
        userRatingCount: relatedRatings.length,
      };
    })
    .sort((left, right) => {
      const order = { 高: 0, 中: 1, 低: 2 };
      return order[left.priority] - order[right.priority] || right.count - left.count;
    });

  for (const batch of evalBatches) {
    if (batch.passRate >= 100 && batch.status !== '运行中') continue;
    const failedCount =
      batch.status === '运行中'
        ? batch.caseCount
        : Math.max(0, Math.round((batch.caseCount * (100 - batch.passRate)) / 100));
    if (failedCount === 0) continue;
    clusters.push({
      id: `eval-failure:${batch.id}`,
      sourceType: 'eval-failure',
      title: `Eval 失败数据 · ${batch.name}`,
      description: `Eval 评测集占位：批次通过率 ${batch.passRate}%，预估失败 ${failedCount} 条；用例级失败数据将在下阶段接入。`,
      primaryDirection: 'Eval',
      directions: clusterDirections('Eval'),
      sampleRunIds: [],
      sampleRuns: [],
      count: failedCount,
      priority: '中',
      ruleCluster: false,
      dimensionAverages: Object.fromEntries(dimensions.map((dimension) => [dimension, null])),
      userRatingAverage: null,
      userRatingCount: 0,
    });
  }

  return {
    clusters,
    records: [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    generatedAt: new Date().toISOString(),
  };
}

function defaultSkillFor(direction: ImprovementDirection): string {
  if (direction === 'Planner') return 'need-extraction';
  if (direction === 'Tool') return 'recommendation-decision';
  if (direction === 'Eval') return 'risk-check';
  return 'response-generator';
}

function findDraftSource(
  center: ImprovementCenterResponse,
  improvementId?: string,
  clusterId?: string,
): { improvement: Improvement | null; cluster: ImprovementCluster | null } {
  const improvement = improvementId
    ? center.records.find((item) => item.id === improvementId) ?? null
    : null;
  const cluster = clusterId
    ? center.clusters.find((item) => item.id === clusterId) ?? null
    : null;
  if (improvementId && !improvement) {
    throw new AppError(404, 'IMPROVEMENT_NOT_FOUND', '改进建议不存在');
  }
  if (clusterId && !cluster) {
    throw new AppError(404, 'CLUSTER_NOT_FOUND', '规则聚类不存在，可能已被处理');
  }
  return { improvement, cluster };
}

function buildDraft(input: {
  currentPrompt: string;
  direction: ImprovementDirection;
  title: string;
  sourceLabel: string;
  sampleRuns: OpsSampleRun[];
  suggestedAction: string;
  ruleCluster: boolean;
}): string {
  const samples = input.sampleRuns
    .slice(0, 5)
    .map((run) => `- ${run.id} · ${run.status} · ${run.question}`)
    .join('\n');
  return `${input.currentPrompt}

## 运营改进草案（规则生成 · 待人工确认）

### 问题来源
- ${input.title}
- 来源：${input.sourceLabel}
- 聚类方式：${input.ruleCluster ? '确定性规则聚类，不是 LLM 分析' : '人工单条触发'}
- 改进方向：${input.direction}

### 样本 Run
${samples || '- 无关联样本'}

### 建议
- ${input.suggestedAction}
- 同类输入先核对真实 Tool 证据，再决定是否补充推荐或澄清。
- 不得承诺超出售后政策的退款、补发或赔偿。

### 验收要求
- 使用运营中心的样本 Run 与低分/低标注证据复核。
- 在正式应用前，必须预览 diff 并由人工确认。
- 应用会创建当前 Skill 的新版本，并保留修改前版本快照。`;
}

export async function generatePromptDraft(raw: unknown): Promise<PromptDraftResponse> {
  const input = promptDraftRequestSchema.parse(raw);
  const center = await getImprovementCenter();
  const { improvement, cluster } = findDraftSource(
    center,
    input.improvementId,
    input.clusterId,
  );
  const direction =
    improvement?.direction ?? cluster?.primaryDirection ?? 'Skill';
  const skillId =
    input.skillId ??
    improvement?.targetSkillId ??
    defaultSkillFor(direction);
  const skill = await getSkillDetail(skillId);
  const sampleRunIds = improvement?.sampleRunIds ?? cluster?.sampleRunIds ?? [];
  const runs = (await readCollection('runs')).filter((run) => sampleRunIds.includes(run.id));
  const sampleRuns = runs.map((run) => sampleFor(run));
  const draftPrompt = buildDraft({
    currentPrompt: skill.systemPrompt,
    direction,
    title: improvement?.title ?? cluster?.title ?? '运营改进',
    sourceLabel: improvement?.source ?? `规则聚类 ${cluster?.id ?? ''}`,
    sampleRuns,
    suggestedAction:
      improvement?.suggestedAction ??
      (cluster?.directions.find((item) => item.direction === direction)?.recommendation ??
        '补强 Skill 的指令、证据引用和安全边界。'),
    ruleCluster: Boolean(cluster?.ruleCluster ?? improvement?.ruleCluster),
  });
  const diff = diffLines(skill.systemPrompt, draftPrompt);
  const stats = {
    added: diff.filter((line) => line.type === 'added').length,
    removed: diff.filter((line) => line.type === 'removed').length,
    unchanged: diff.filter((line) => line.type === 'context').length,
  };

  if (improvement) {
    await updateCollection('improvements', (current) =>
      current.map((item) =>
        item.id === improvement.id
          ? {
              ...item,
              targetSkillId: skill.id,
              promptDraft: draftPrompt,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
  }

  return {
    ruleBased: true,
    notice: '规则生成草案：未调用 LLM，未自动应用，不会覆盖生产 Prompt。',
    skill,
    currentPrompt: skill.systemPrompt,
    currentHash: skill.hash,
    draftPrompt,
    diff,
    stats,
    cluster,
    improvement,
  };
}

export async function applyPromptDraft(raw: unknown): Promise<PromptApplyResponse> {
  const input = promptApplyRequestSchema.parse(raw);
  const center = await getImprovementCenter();
  const { improvement, cluster } = findDraftSource(
    center,
    input.improvementId,
    input.clusterId,
  );
  const current = await getSkillDetail(input.skillId);
  if (current.hash !== input.expectedHash) {
    throw new AppError(
      409,
      'REVISION_CONFLICT',
      'Skill 已被其他操作更新，请重新生成草案后再应用',
      { expectedHash: input.expectedHash, currentHash: current.hash },
    );
  }
  const skill = await saveSkillVersion(current.id, {
    name: current.name,
    description: current.description,
    model: current.model,
    temperature: current.temperature,
    maxTokens: current.maxTokens,
    requiredTools: current.requiredTools,
    systemPrompt: input.draftPrompt,
    changeNote: input.changeNote,
    expectedHash: current.hash,
  });

  const now = new Date().toISOString();
  let record: Improvement;
  if (improvement) {
    const updated = {
      ...improvement,
      status: '已完成' as const,
      owner: improvement.owner === '待分配' ? '运营管理员' : improvement.owner,
      targetSkillId: skill.id,
      promptDraft: input.draftPrompt,
      updatedAt: now,
    };
    await updateCollection('improvements', (currentRecords) =>
      currentRecords.map((item) => (item.id === improvement.id ? updated : item)),
    );
    record = updated;
  } else {
    const direction = cluster?.primaryDirection ?? 'Skill';
    record = {
      id: `improvement-${Date.now()}-${randomUUID().slice(0, 6)}`,
      title: cluster?.title ?? 'Prompt 改进应用',
      source: cluster ? `规则聚类 ${cluster.id}` : '运营中心 Prompt 草案',
      sourceType: cluster?.sourceType ?? 'manual',
      direction,
      description: cluster?.description ?? '从运营中心生成的 Prompt 草案。',
      ruleCluster: Boolean(cluster?.ruleCluster),
      sampleRunIds: cluster?.sampleRunIds ?? [],
      suggestedAction: cluster?.directions.find((item) => item.direction === direction)?.recommendation ?? '',
      targetSkillId: skill.id,
      promptDraft: input.draftPrompt,
      priority: cluster?.priority ?? '中',
      status: '已完成',
      owner: '运营管理员',
      createdAt: now,
      updatedAt: now,
    };
    await updateCollection('improvements', (currentRecords) => [record, ...currentRecords]);
  }

  return { skill, improvement: record };
}
