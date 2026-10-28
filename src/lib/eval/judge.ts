import 'server-only';

import { AppError } from '@/lib/errors';
import { createLlmClient } from '@/lib/llm/config';
import { detectInputSignals } from '@/lib/agent/signals';
import type { EvalCase, Run } from '@/lib/schemas';
import type { EvalConfig } from '@/lib/types';
import type { JudgeInput } from './detailed-score';

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function judgePrompt(evalCase: EvalCase, config: EvalConfig): string {
  return [
    config.judgeSystemPrompt,
    evalCase.llmJudgePrompt
      ? `\n\n## 当前用例 Judge 标准\n${evalCase.llmJudgePrompt}`
      : '',
  ].join('');
}

export async function judgeEvalCase(input: {
  evalCase: EvalCase;
  run: Run;
  config: EvalConfig;
}): Promise<JudgeInput> {
  const { evalCase, run, config } = input;
  const prompt = judgePrompt(evalCase, config);
  if (!config.judgeEnabled) {
    return {
      enabled: false,
      score: null,
      reason: 'LLM-as-Judge 未启用。',
      prompt,
      provider: null,
      model: null,
      error: null,
    };
  }
  if (!evalCase.expectedReply.trim() && !evalCase.llmJudgePrompt.trim() && evalCase.expectedKeywords.length === 0) {
    return {
      enabled: true,
      score: null,
      reason: '用例没有 Judge 标准（expectedReply / llmJudgePrompt / 关键词），未调用 Judge。',
      prompt,
      provider: null,
      model: null,
      error: null,
    };
  }

  let client;
  try {
    client = await createLlmClient(undefined);
  } catch (error) {
    return {
      enabled: true,
      score: null,
      reason: error instanceof Error ? error.message : 'Judge Provider 初始化失败',
      prompt,
      provider: null,
      model: null,
      error: error instanceof AppError ? error.code : 'JUDGE_PROVIDER_FAILED',
    };
  }
  if (client.info.id === 'classroom-fixture') {
    return {
      enabled: true,
      score: null,
      reason: '当前 Provider 为 classroom-fixture，不能生成真实 LLM Judge 分数。请切换到 openai-compatible 或 coze。',
      prompt,
      provider: client.info.id,
      model: client.info.model,
      error: 'JUDGE_PROVIDER_UNSUPPORTED',
    };
  }

  const evidence = [
    `用户问题：${evalCase.question}`,
    `期望回复：${evalCase.expectedReply || '（未提供）'}`,
    `期望关键词：${evalCase.expectedKeywords.join('、') || '（无）'}`,
    `期望 Tool 事实：${evalCase.expectedToolFacts.join('、') || '（无）'}`,
    `实际最终回复：${run.finalReply ?? ''}`,
    `Tool 输出：${run.steps.filter((step) => step.type === 'tool').map((step) => JSON.stringify(step.output)).join('\n').slice(0, 6000)}`,
    '\n请严格输出 JSON：{"score": 0-100, "relevance": 0-100, "completeness": 0-100, "factuality": 0-100, "tone": 0-100, "reason": "..."}。',
  ].join('\n\n');
  const signals = detectInputSignals(evalCase.question);
  try {
    const generation = await client.generate({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: evidence },
      ],
      temperature: config.judgeTemperature,
      maxTokens: 800,
      json: true,
      purpose: 'judge',
      fixture: {
        task: 'judge',
        userInput: evalCase.question,
        conversationHistory: [],
        mandatoryCapabilities: [],
        signals,
        availableSkills: [],
        availableTools: [],
        candidateReply: run.finalReply ?? '',
      },
    });
    const parsed = extractJson(generation.text) as { score?: unknown; reason?: unknown } | null;
    const score = typeof parsed?.score === 'number' && Number.isFinite(parsed.score) ? Math.min(100, Math.max(0, parsed.score)) : null;
    if (score === null) {
      return {
        enabled: true,
        score: null,
        reason: `Judge 返回内容无法解析为 0–100 分数：${generation.text.slice(0, 240)}`,
        prompt,
        provider: generation.provider,
        model: generation.model,
        error: 'JUDGE_INVALID_OUTPUT',
      };
    }
    return {
      enabled: true,
      score,
      reason: typeof parsed?.reason === 'string' ? parsed.reason : 'Judge 未提供理由。',
      prompt,
      provider: generation.provider,
      model: generation.model,
      error: null,
    };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        enabled: true,
        score: null,
        reason: `${error.code}：${error.message}`,
        prompt,
        provider: client.info.id,
        model: client.info.model,
        error: error.code,
      };
    }
    return {
      enabled: true,
      score: null,
      reason: error instanceof Error ? error.message : 'Judge 调用失败',
      prompt,
      provider: client.info.id,
      model: client.info.model,
      error: 'JUDGE_FAILED',
    };
  }
}
