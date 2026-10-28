import 'server-only';

import { readCollection } from '@/lib/store';
import type { OpsOverview } from '@/lib/types';
import { ensureEvaluationQueue } from './annotations';

export async function getOpsOverview(): Promise<OpsOverview> {
  await ensureEvaluationQueue();
  const [runs, ratings, annotations] = await Promise.all([
    readCollection('runs'),
    readCollection('ratings'),
    readCollection('annotations'),
  ]);
  const totalRuns = runs.length;
  const successes = runs.filter((run) => run.status === '成功').length;
  const handoffs = runs.filter((run) => Boolean(run.handoff)).length;
  const durations = runs
    .map((run) => run.durationMs)
    .filter((duration) => Number.isFinite(duration) && duration >= 0);
  const failedStepSamples = runs.flatMap((run) =>
    run.steps
      .filter((step) => step.status === 'ERROR')
      .map((step) => ({
        runId: run.id,
        question: run.question,
        stepId: step.id,
        capabilityId: step.capabilityId,
        error: step.error,
      })),
  );
  const riskLevels = ['none', 'low', 'medium', 'high'];
  const riskDistribution = riskLevels.map((level) => ({
    level,
    count: runs.filter((run) => (run.riskResult?.riskLevel ?? 'none') === level).length,
  }));

  return {
    totalRuns,
    successRate: totalRuns === 0 ? 0 : Math.round((successes / totalRuns) * 1000) / 10,
    averageDurationMs:
      durations.length === 0
        ? 0
        : Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length),
    failedSteps: failedStepSamples.length,
    handoffRate: totalRuns === 0 ? 0 : Math.round((handoffs / totalRuns) * 1000) / 10,
    riskDistribution,
    recentRuns: [...runs]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 10),
    failedStepSamples: failedStepSamples.slice(0, 10),
    lowRatingCount: ratings.filter((rating) => rating.score <= 2).length,
    pendingAnnotationCount: annotations.filter((annotation) => annotation.status === 'pending').length,
    pendingEvaluationCount: annotations.filter((annotation) => annotation.status === 'evaluating').length,
    generatedAt: new Date().toISOString(),
  };
}
