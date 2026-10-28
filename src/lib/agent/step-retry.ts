import 'server-only';

import { AppError } from '@/lib/errors';
import type { AgentStep } from '@/lib/schemas';
import { executeTool, getTool } from '@/lib/registry/tools';
import { getRun, updateRun } from './runs';

function errorMessage(caught: unknown): string {
  if (caught instanceof AppError) return `${caught.code}: ${caught.message}`;
  if (caught instanceof Error) return caught.message;
  return '未知错误';
}

export async function retryToolStep(input: {
  runId: string;
  stepId: string;
}): Promise<{ run: Awaited<ReturnType<typeof updateRun>>; step: AgentStep; previousStatus: string }> {
  const run = await getRun(input.runId);
  const failedStep = run.steps.find((step) => step.id === input.stepId);
  if (!failedStep) {
    throw new AppError(404, 'STEP_NOT_FOUND', '执行步骤不存在');
  }
  if (failedStep.status !== 'ERROR') {
    throw new AppError(400, 'STEP_NOT_FAILED', '只有失败步骤可以重试');
  }
  if (failedStep.type !== 'tool') {
    throw new AppError(
      422,
      'SKILL_STEP_RETRY_UNSUPPORTED',
      'Skill 步骤依赖完整会话上下文，请使用“重试运行”；当前支持独立重试失败的 Tool 步骤。',
    );
  }

  const tool = await getTool(failedStep.capabilityId);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let newStep: AgentStep;

  try {
    const execution = await executeTool(failedStep.capabilityId, failedStep.input);
    newStep = {
      id: `step-${run.steps.length + 1}`,
      index: run.steps.length,
      type: 'tool',
      capabilityId: failedStep.capabilityId,
      title: `${failedStep.title}（重试）`,
      input: execution.input,
      output: execution.output,
      durationMs: Date.now() - new Date(startedAt).getTime(),
      status: 'SUCCESS',
      error: null,
      startedAt,
      finishedAt: new Date().toISOString(),
      version: tool.version,
    };
  } catch (caught) {
    const message = errorMessage(caught);
    newStep = {
      id: `step-${run.steps.length + 1}`,
      index: run.steps.length,
      type: 'tool',
      capabilityId: failedStep.capabilityId,
      title: `${failedStep.title}（重试）`,
      input: failedStep.input,
      output: null,
      durationMs: Math.round(performance.now() - started),
      status: 'ERROR',
      error: message,
      startedAt,
      finishedAt: new Date().toISOString(),
      version: tool.version,
    };
  }

  const updated = await updateRun(input.runId, (current) => ({
    ...current,
    steps: [...current.steps, newStep],
  }));
  return { run: updated, step: newStep, previousStatus: run.status };
}
