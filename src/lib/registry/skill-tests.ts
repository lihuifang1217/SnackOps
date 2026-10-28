import 'server-only';

import { randomUUID } from 'node:crypto';
import { AppError } from '@/lib/errors';
import { detectInputSignals } from '@/lib/agent/signals';
import { deriveToolInput } from '@/lib/agent/tool-input';
import type { ToolResultSnapshot } from '@/lib/agent/risk';
import { createLlmClient } from '@/lib/llm/config';
import type { LlmClient } from '@/lib/llm/types';
import { readCollection, updateCollection } from '@/lib/store';
import type { SkillTest, SkillTestDependency, SkillTestToolRun } from '@/lib/schemas';
import type {
  AgentProviderSelection,
  SkillConfigCheck,
  SkillConfigIssue,
  SkillTestExecutionResponse,
  SkillTestHistoryResponse,
} from '@/lib/types';
import { executeTool, getTool, listTools } from './tools';
import { getSkillDetail, listSkills } from './skills';

const DEFAULT_TEST_TIMEOUT_MS = 30_000;

function testTimeoutMs(): number {
  const configured = Number(process.env.SKILL_TEST_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_TEST_TIMEOUT_MS;
  return Math.min(120_000, Math.max(1_000, Math.round(configured)));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppError(
          504,
          'SKILL_TEST_TIMEOUT',
          `Skill 单项测试超过 ${timeoutMs}ms，已记录超时错误。`,
        ),
      );
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function resolveSkillModel(skill: { model: string }, provider: LlmClient): string {
  if (provider.info.isDemo) return provider.info.model;
  if (skill.model === 'snackops-fixture-v1' || !skill.model.trim()) return provider.info.model;
  return skill.model;
}

async function dependencyChecks(requiredTools: string[]): Promise<SkillTestDependency[]> {
  const tools = await listTools();
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  return requiredTools.map((toolId) => {
    const tool = byId.get(toolId);
    if (!tool) {
      return {
        toolId,
        name: toolId,
        exists: false,
        enabled: false,
        status: 'MISSING',
        error: '工具不存在',
      };
    }
    if (!tool.enabled) {
      return {
        toolId,
        name: tool.name,
        exists: true,
        enabled: false,
        status: 'DISABLED',
        error: '工具已停用',
      };
    }
    return {
      toolId,
      name: tool.name,
      exists: true,
      enabled: true,
      status: 'READY',
      error: null,
    };
  });
}

export async function checkSkillConfig(skillId: string): Promise<SkillConfigCheck> {
  const skill = await getSkillDetail(skillId);
  const dependencies = await dependencyChecks(skill.requiredTools);
  const issues: SkillConfigIssue[] = [];

  for (const dependency of dependencies) {
    if (dependency.status === 'MISSING') {
      issues.push({
        code: 'TOOL_MISSING',
        message: `依赖工具 ${dependency.toolId} 不存在`,
        severity: 'error',
      });
    }
    if (dependency.status === 'DISABLED') {
      issues.push({
        code: 'TOOL_DISABLED',
        message: `依赖工具 ${dependency.name} 已停用`,
        severity: 'error',
      });
    }
  }
  if (!skill.enabled) {
    issues.push({
      code: 'SKILL_DISABLED',
      message: '该 Skill 当前已停用；单项测试仍可运行，但 Planner 不会选择它。',
      severity: 'warning',
    });
  }
  if (skill.promptLength < 20) {
    issues.push({
      code: 'PROMPT_TOO_SHORT',
      message: 'SKILL.md 内容过短，可能无法稳定执行。',
      severity: 'error',
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    skill,
    hash: skill.hash,
    filePath: skill.filePath,
    promptLength: skill.promptLength,
    dependencies,
    checkedAt: new Date().toISOString(),
  };
}

export async function listSkillTests(skillId: string): Promise<SkillTest[]> {
  const tests = await readCollection('skill-tests');
  return tests
    .filter((test) => test.skillId === skillId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 20);
}

async function saveTest(test: SkillTest): Promise<void> {
  await updateCollection('skill-tests', (current) => [test, ...current].slice(0, 200));
}

function buildTestMessages(input: {
  systemPrompt: string;
  sampleInput: string;
  toolRuns: SkillTestToolRun[];
}): { role: 'system' | 'user'; content: string }[] {
  const toolContext =
    input.toolRuns.length === 0
      ? '无工具依赖'
      : input.toolRuns
          .map(
            (run) =>
              `### ${run.toolId} (${run.status})\nInput: ${JSON.stringify(run.input)}\nOutput: ${JSON.stringify(run.output ?? null)}\nError: ${run.error ?? '无'}`,
          )
          .join('\n\n');

  return [
    { role: 'system', content: input.systemPrompt },
    {
      role: 'user',
      content: `这是单项 Skill 测试，不是完整 Agent 运行，不需要 Planner 或最终风险链路。

测试样本：
${input.sampleInput}

已执行的必要工具上下文：
${toolContext}

请严格按 Skill 定义输出本技能结果。若定义要求 JSON，只输出 JSON。`,
    },
  ];
}

export async function runSkillTest(input: {
  skillId: string;
  sampleInput: string;
  provider?: AgentProviderSelection;
}): Promise<SkillTestExecutionResponse> {
  const skill = await getSkillDetail(input.skillId);
  const provider = await createLlmClient(input.provider ?? 'auto');
  const config = await checkSkillConfig(input.skillId);
  const startedAt = Date.now();
  const dependencies: SkillTestDependency[] = config.dependencies;

  // 配置不满足时明确记录失败，不调用模型，也不伪造成功。
  if (!config.valid) {
    const test: SkillTest = {
      id: `skill-test-${Date.now()}-${randomUUID().slice(0, 6)}`,
      skillId: skill.id,
      skillVersion: skill.version,
      hash: skill.hash,
      provider: provider.info.id,
      model: provider.info.model,
      input: input.sampleInput,
      output: null,
      durationMs: Date.now() - startedAt,
      status: 'ERROR',
      error: config.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('；'),
      dependencies,
      toolRuns: [],
      createdAt: new Date().toISOString(),
    };
    await saveTest(test);
    return { test, config };
  }

  const signals = detectInputSignals(input.sampleInput);
  const toolResults: ToolResultSnapshot[] = [];
  const toolRuns: SkillTestToolRun[] = [];
  const availableTools = await listTools();
  const availableSkills = await listSkills();

  for (const dependency of dependencies) {
    const toolStart = Date.now();
    const tool = await getTool(dependency.toolId);
    const derived = await deriveToolInput({
      toolId: dependency.toolId,
      signals,
      toolResults,
    });
    if (derived.error) {
      toolRuns.push({
        toolId: dependency.toolId,
        name: tool.name,
        input: derived.input,
        output: null,
        durationMs: Date.now() - toolStart,
        status: 'ERROR',
        error: derived.error,
      });
      toolResults.push({
        toolId: dependency.toolId,
        status: 'ERROR',
        input: derived.input,
        error: derived.error,
      });
      continue;
    }

    try {
      const execution = await executeTool(dependency.toolId, derived.input);
      toolRuns.push({
        toolId: dependency.toolId,
        name: tool.name,
        input: derived.input,
        output: execution.output,
        durationMs: execution.durationMs,
        status: 'SUCCESS',
        error: null,
      });
      toolResults.push({
        toolId: dependency.toolId,
        status: 'SUCCESS',
        input: derived.input,
        output: execution.output,
      });
    } catch (error) {
      const message = error instanceof AppError ? error.message : '工具执行失败';
      toolRuns.push({
        toolId: dependency.toolId,
        name: tool.name,
        input: derived.input,
        output: null,
        durationMs: Date.now() - toolStart,
        status: 'ERROR',
        error: message,
      });
      toolResults.push({
        toolId: dependency.toolId,
        status: 'ERROR',
        input: derived.input,
        error: message,
      });
    }
  }

  const failedTools = toolRuns.filter((run) => run.status === 'ERROR');
  if (failedTools.length > 0) {
    const test: SkillTest = {
      id: `skill-test-${Date.now()}-${randomUUID().slice(0, 6)}`,
      skillId: skill.id,
      skillVersion: skill.version,
      hash: skill.hash,
      provider: provider.info.id,
      model: provider.info.model,
      input: input.sampleInput,
      output: null,
      durationMs: Date.now() - startedAt,
      status: 'ERROR',
      error: `必要工具依赖执行失败：${failedTools.map((run) => `${run.toolId} ${run.error ?? ''}`).join('；')}`,
      dependencies,
      toolRuns,
      createdAt: new Date().toISOString(),
    };
    await saveTest(test);
    return { test, config };
  }

  const model = resolveSkillModel(skill, provider);
  let output: string | null = null;
  let status: SkillTest['status'] = 'SUCCESS';
  let error: string | null = null;

  try {
    const generation = await withTimeout(
      provider.generate({
        messages: buildTestMessages({
          systemPrompt: skill.systemPrompt,
          sampleInput: input.sampleInput,
          toolRuns,
        }),
        temperature: skill.temperature,
        maxTokens: skill.maxTokens,
        model,
        purpose: 'skill',
        fixture: {
          task: 'skill',
          userInput: input.sampleInput,
          conversationHistory: [],
          mandatoryCapabilities: skill.requiredTools.map((toolId) => `tool:${toolId}`),
          signals,
          availableSkills: availableSkills.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
          })),
          availableTools: availableTools.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
          })),
          skillId: skill.id,
          skillName: skill.name,
          toolResults,
          previousSkills: [],
        },
      }),
      testTimeoutMs(),
    );
    output = generation.text;
  } catch (caught) {
    status = 'ERROR';
    error =
      caught instanceof AppError
        ? `${caught.code}: ${caught.message}`
        : caught instanceof Error
          ? caught.message
          : 'Skill 单项测试失败';
  }

  const test: SkillTest = {
    id: `skill-test-${Date.now()}-${randomUUID().slice(0, 6)}`,
    skillId: skill.id,
    skillVersion: skill.version,
    hash: skill.hash,
    provider: provider.info.id,
    model,
    input: input.sampleInput,
    output,
    durationMs: Date.now() - startedAt,
    status,
    error,
    dependencies,
    toolRuns,
    createdAt: new Date().toISOString(),
  };
  await saveTest(test);
  return { test, config };
}

export async function getSkillTestPanel(skillId: string): Promise<SkillTestHistoryResponse> {
  const [config, tests] = await Promise.all([
    checkSkillConfig(skillId),
    listSkillTests(skillId),
  ]);
  return { config, tests };
}

