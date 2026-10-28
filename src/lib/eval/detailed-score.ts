import type { EvalCase, Run } from '@/lib/schemas';
import { scoreEvalCase, type EvalScore } from './scorer';

export type ScoreDimensionKey = 'planner' | 'skill' | 'tool' | 'reply' | 'risk' | 'performance';

export type DimensionWeight = Record<ScoreDimensionKey, number>;

export type DimensionDetail = {
  key: ScoreDimensionKey;
  label: string;
  score: number;
  weight: number;
  weighted: number;
  basis: string;
  details: string[];
};

export type JudgeDetail = {
  enabled: boolean;
  score: number | null;
  reason: string;
  prompt: string;
  provider: string | null;
  model: string | null;
  error: string | null;
};

export type HumanDetail = {
  enabled: boolean;
  scores: EvalCase['humanScores'];
  score: number | null;
  weight: number;
  weighted: number;
  details: string[];
};

export type CosineDetail = {
  available: boolean;
  score: number | null;
  method: string;
  detail: string;
};

export type DetailedEvalScore = EvalScore & {
  totalScore: number;
  weightedTotal: number;
  passThreshold: number;
  dimensions: Record<ScoreDimensionKey, DimensionDetail>;
  weights: DimensionWeight;
  humanWeight: number;
  precision: {
    score: number;
    hitRate: number;
    keywordHits: string[];
    keywordMisses: string[];
    forbiddenHits: string[];
    detail: string;
  };
  cosine: CosineDetail;
  judge: JudgeDetail;
  human: HumanDetail;
  calculation: string[];
  issues: string[];
  runCreatedAt: string;
  stepCount: number;
  plannerSummary: string;
  source: 'annotation' | 'run' | 'manual';
  sourceLabel: string;
};

export type JudgeInput = {
  enabled: boolean;
  score: number | null;
  reason: string;
  prompt: string;
  provider?: string | null;
  model?: string | null;
  error?: string | null;
};

const BASE_WEIGHTS: DimensionWeight = {
  planner: 0.2,
  skill: 0.15,
  tool: 0.25,
  reply: 0.25,
  risk: 0.1,
  performance: 0.05,
};

const HUMAN_WEIGHTS: DimensionWeight = {
  planner: 0.18,
  skill: 0.14,
  tool: 0.23,
  reply: 0.23,
  risk: 0.09,
  performance: 0.03,
};

const DIMENSION_LABELS: Record<ScoreDimensionKey, string> = {
  planner: 'Planner',
  skill: 'Skill',
  tool: 'Tool',
  reply: '回复',
  risk: '风控',
  performance: '性能',
};

const PRICE_TOOLS = ['query_products', 'query_activities', 'query_coupons', 'calculate_price'];

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function includesText(haystack: string, needle: string): boolean {
  return haystack.toLocaleLowerCase('zh-CN').includes(needle.toLocaleLowerCase('zh-CN'));
}

function actualCapabilities(run: Run): Set<string> {
  const actual = new Set<string>();
  for (const skill of run.plan?.selectedSkills ?? []) {
    actual.add(skill);
    actual.add(`skill:${skill}`);
  }
  for (const tool of run.plan?.selectedTools ?? []) {
    actual.add(tool);
    actual.add(`tool:${tool}`);
  }
  for (const step of run.steps) {
    actual.add(step.capabilityId);
    actual.add(`${step.type}:${step.capabilityId}`);
  }
  return actual;
}

function hasCapability(actual: Set<string>, value: string): boolean {
  const bare = value.replace(/^(skill|tool):/, '');
  return actual.has(value) || actual.has(bare) || actual.has(`skill:${bare}`) || actual.has(`tool:${bare}`);
}

function indexOfStep(run: Run, capabilityId: string): number {
  return run.steps.findIndex((step) => step.capabilityId === capabilityId);
}

function tokenize(text: string): Map<string, number> {
  const normalized = text.toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
  const tokens = new Map<string, number>();
  const words = normalized.match(/[a-z0-9_.-]+|[\u4e00-\u9fff]/g) ?? [];
  for (const word of words) tokens.set(word, (tokens.get(word) ?? 0) + 1);
  const cjk = [...normalized].filter((char) => /[\u4e00-\u9fff]/.test(char));
  for (let index = 0; index < cjk.length - 1; index += 1) {
    const bigram = `${cjk[index]}${cjk[index + 1]}`;
    tokens.set(bigram, (tokens.get(bigram) ?? 0) + 1);
  }
  return tokens;
}

function cosineSimilarity(expected: string, actual: string): CosineDetail {
  if (!expected.trim() || !actual.trim()) {
    return {
      available: false,
      score: null,
      method: '字符/词袋余弦相似度',
      detail: expected.trim() ? '回复为空，无法计算余弦相似度。' : '用例未提供 expectedReply，余弦相似度仅作辅助诊断。',
    };
  }
  const left = tokenize(expected);
  const right = tokenize(actual);
  let dot = 0;
  for (const [token, count] of left) dot += count * (right.get(token) ?? 0);
  let leftNorm = 0;
  let rightNorm = 0;
  for (const count of left.values()) leftNorm += count * count;
  for (const count of right.values()) rightNorm += count * count;
  const score = leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm);
  return {
    available: true,
    score: round(score * 100),
    method: '字符/词袋余弦相似度',
    detail: `expectedReply 与实际回复的余弦相似度 ${round(score * 100)}%，仅作辅助诊断，不进入总分。`,
  };
}

function humanScore(evalCase: EvalCase): { score: number | null; details: string[] } {
  const scores = evalCase.humanScores;
  if (!scores) return { score: null, details: ['用例没有六维人工标注评分。'] };
  let score = 100;
  const details: string[] = [];
  for (const key of ['correctness', 'relevance', 'completeness', 'safety', 'tone', 'overall'] as const) {
    const value = scores[key];
    if (value < 3) {
      const penalty = (3 - value) * 12;
      score -= penalty;
      details.push(`${key} ${value}/5 低于 3，扣 ${penalty}`);
    }
  }
  return { score: round(clamp(score)), details };
}

export function scoreEvalCaseDetailed(input: {
  evalCase: EvalCase;
  run: Run | null;
  judge?: JudgeInput | null;
}): DetailedEvalScore {
  const { evalCase, run } = input;
  const flat = scoreEvalCase({ evalCase, run });
  const judgeInput = input.judge ?? {
    enabled: false,
    score: null,
    reason: 'LLM-as-Judge 未启用。',
    prompt: evalCase.llmJudgePrompt,
    provider: null,
    model: null,
    error: null,
  };
  const humanEnabled = Boolean(evalCase.humanScores);
  const weights = humanEnabled ? HUMAN_WEIGHTS : BASE_WEIGHTS;
  const humanWeight = humanEnabled ? 0.1 : 0;
  const human = humanScore(evalCase);

  if (!run || run.status === '失败' || !run.finalReply?.trim()) {
    const zeroDimensions = Object.fromEntries(
      (Object.keys(BASE_WEIGHTS) as ScoreDimensionKey[]).map((key) => [
        key,
        {
          key,
          label: DIMENSION_LABELS[key],
          score: 0,
          weight: weights[key],
          weighted: 0,
          basis: 'Agent 没有可评分的最终回复',
          details: [flat.reason],
        },
      ]),
    ) as Record<ScoreDimensionKey, DimensionDetail>;
    return {
      ...flat,
      totalScore: 0,
      weightedTotal: 0,
      passThreshold: 80,
      dimensions: zeroDimensions,
      weights,
      humanWeight,
      precision: {
        score: 0,
        hitRate: 0,
        keywordHits: flat.keywordHits,
        keywordMisses: flat.keywordMisses,
        forbiddenHits: flat.forbiddenHits,
        detail: 'Agent 没有可评分的最终回复',
      },
      cosine: {
        available: false,
        score: null,
        method: '字符/词袋余弦相似度',
        detail: '没有最终回复，无法计算。',
      },
      judge: {
        enabled: judgeInput.enabled,
        score: judgeInput.score,
        reason: judgeInput.reason,
        prompt: judgeInput.prompt,
        provider: judgeInput.provider ?? null,
        model: judgeInput.model ?? null,
        error: judgeInput.error ?? null,
      },
      human: {
        enabled: humanEnabled,
        scores: evalCase.humanScores,
        score: human.score,
        weight: humanWeight,
        weighted: 0,
        details: human.details,
      },
      calculation: ['Agent 没有成功最终回复，总分记 0。'],
      issues: [flat.reason],
      runCreatedAt: run?.createdAt ?? '',
      stepCount: run?.steps.length ?? 0,
      plannerSummary: run?.plan?.goal ?? '无 Planner 摘要',
      source: evalCase.humanScores ? 'annotation' : evalCase.sourceRunId ? 'run' : 'manual',
      sourceLabel: evalCase.humanScores ? '人工标注' : evalCase.sourceRunId ? 'Run 导入' : '手工用例',
    };
  }

  const actual = actualCapabilities(run);
  const plannerMissing = flat.missingCapabilities.length;
  const plannerForbidden = flat.forbiddenCapabilityHits.length;
  const lastStep = run.steps.at(-1);
  const riskLast = Boolean(lastStep?.type === 'skill' && lastStep.capabilityId === 'risk-check');
  const plannerScore = clamp(100 - plannerMissing * 30 - plannerForbidden * 35 - (riskLast ? 0 : 50));

  const failedSkills = run.steps.filter((step) => step.type === 'skill' && step.status === 'ERROR').length;
  const skillScore = clamp(100 - failedSkills * 50);

  const toolText = run.steps.map((step) => JSON.stringify(step.output)).join('\n');
  const expectedFacts = evalCase.expectedToolFacts;
  const factHits = expectedFacts.filter((fact) => includesText(toolText, fact));
  const factRate = expectedFacts.length === 0 ? 100 : (factHits.length / expectedFacts.length) * 100;
  const declaredTools = evalCase.requiredCapabilities.filter((item) => item.startsWith('tool:') || item.includes('tool:'));
  const priceIntent =
    evalCase.expectedPrice !== null || /价格|多少钱|优惠|满减|券|折扣|预算/.test(evalCase.question);
  const missingPriceTools = priceIntent && declaredTools.length > 0
    ? PRICE_TOOLS.filter((tool) => !hasCapability(actual, `tool:${tool}`))
    : [];
  const calculateIndex = indexOfStep(run, 'calculate_price');
  const recommendationIndex = indexOfStep(run, 'recommendation-decision');
  const priceOrderPenalty = priceIntent && calculateIndex >= 0 && recommendationIndex >= 0 && calculateIndex < recommendationIndex ? 30 : 0;
  const toolScore = clamp(factRate - missingPriceTools.length * 25 - priceOrderPenalty);

  const precisionPenalty = flat.forbiddenHits.length * 35;
  const hitRate = evalCase.expectedKeywords.length === 0 ? 100 : (flat.keywordHits.length / evalCase.expectedKeywords.length) * 100;
  const precisionScore = clamp(hitRate - precisionPenalty);
  const judgeScore = judgeInput.enabled && judgeInput.score !== null ? clamp(judgeInput.score) : null;
  const replyScore = judgeScore === null ? precisionScore : 0.55 * precisionScore + 0.45 * judgeScore;

  const riskScore =
    evalCase.expectRiskPassed
      ? run.riskResult?.decision === 'allow' && flat.replySafe
        ? 100
        : 0
      : riskLast
        ? 100
        : 0;

  const maxLatency = evalCase.maxLatencyMs ?? 3000;
  const performanceScore =
    run.durationMs <= maxLatency ? 100 : clamp(100 - ((run.durationMs - maxLatency) / maxLatency) * 100);

  const cosine = cosineSimilarity(evalCase.expectedReply, run.finalReply);

  const dimensionScores: Record<ScoreDimensionKey, number> = {
    planner: plannerScore,
    skill: skillScore,
    tool: toolScore,
    reply: replyScore,
    risk: riskScore,
    performance: performanceScore,
  };
  const dimensions = Object.fromEntries(
    (Object.keys(BASE_WEIGHTS) as ScoreDimensionKey[]).map((key) => {
      const score = dimensionScores[key];
      const weighted = score * weights[key];
      const detailMap: Record<ScoreDimensionKey, string[]> = {
        planner: [
          `期望能力缺失 ${plannerMissing} 个，每个 −30`,
          `误用禁止能力 ${plannerForbidden} 个，每个 −35`,
          riskLast ? 'risk-check 位于最后一步' : 'risk-check 不在最后一步，−50',
        ],
        skill: [`Skill 执行失败 ${failedSkills} 个，每个 −50`],
        tool: [
          expectedFacts.length === 0 ? '未声明期望 Tool 事实，事实命中率按 100 计' : `Tool 事实命中 ${factHits.length}/${expectedFacts.length}`,
          priceIntent ? `价格 Tool 缺失 ${missingPriceTools.length} 个，每个 −25` : '非价格意图，不扣价格 Tool',
          priceOrderPenalty ? '价格计算早于推荐决策，−30' : '价格计算顺序正常或无推荐决策',
        ],
        reply: [
          `精准匹配命中率 ${round(hitRate)}%，禁用表述 ${flat.forbiddenHits.length} 个，每个 −35`,
          judgeScore === null ? 'Judge 未启用或无有效分数，精准匹配占 100%' : `Judge ${round(judgeScore)}，按 55% 精准 + 45% Judge`,
        ],
        risk: [
          evalCase.expectRiskPassed
            ? run.riskResult?.decision === 'allow' && flat.replySafe
              ? '必须通过风控且已通过'
              : '必须通过风控但未通过'
            : riskLast
              ? '非强制风控，risk-check 位于最后一步'
              : '非强制风控，risk-check 不在最后一步',
        ],
        performance: [`耗时 ${run.durationMs}ms / 上限 ${maxLatency}ms`],
      };
      return [
        key,
        {
          key,
          label: DIMENSION_LABELS[key],
          score: round(score),
          weight: weights[key],
          weighted: round(weighted),
          basis: detailMap[key][0],
          details: detailMap[key],
        },
      ];
    }),
  ) as Record<ScoreDimensionKey, DimensionDetail>;

  const weightedTotal = Object.values(dimensions).reduce((sum, item) => sum + item.weighted, 0);
  const humanWeighted = human.score === null ? 0 : human.score * humanWeight;
  const rawTotal = weightedTotal + humanWeighted;
  const totalScore = Math.round(clamp(rawTotal));
  const calculation = [
    ...Object.values(dimensions).map(
      (item) => `${item.label} ${item.score} × ${(item.weight * 100).toFixed(0)}% = ${item.weighted.toFixed(1)}`,
    ),
    ...(humanEnabled && human.score !== null
      ? [`人工评估 ${human.score} × 10% = ${humanWeighted.toFixed(1)}`]
      : []),
    `总分 = ${weightedTotal.toFixed(1)}${humanEnabled ? ` + ${humanWeighted.toFixed(1)}` : ''} = ${totalScore}（四舍五入，0–100）`,
  ];

  let status = flat.status;
  let reason = flat.reason;
  const semanticRequired = Boolean(evalCase.expectedReply.trim() || evalCase.llmJudgePrompt.trim());
  if (status === 'PASS' && totalScore < 80) {
    status = 'FAIL';
    reason = `总分 ${totalScore} 低于通过线 80，判定 FAIL。`;
  }
  if (status === 'REVIEW' && semanticRequired && judgeScore !== null) {
    status = totalScore >= 80 ? 'PASS' : 'FAIL';
    reason = status === 'PASS' ? `Judge ${judgeScore} 与确定性断言共同通过；总分 ${totalScore}。` : `总分 ${totalScore} 低于通过线 80。`;
  }
  if (status === 'REVIEW' && semanticRequired && judgeScore === null) {
    reason = judgeInput.enabled
      ? `LLM-as-Judge 已启用，但本次未得到有效分数：${judgeInput.error ? `${judgeInput.error} · ` : ''}${judgeInput.reason || 'Judge 未返回评分'}`
      : 'LLM-as-Judge 未启用，无法验证 expectedReply / llmJudgePrompt。';
  }

  return {
    ...flat,
    status,
    passed: status === 'PASS',
    reason,
    totalScore,
    weightedTotal: round(weightedTotal),
    passThreshold: 80,
    dimensions,
    weights,
    humanWeight,
    precision: {
      score: round(precisionScore),
      hitRate: round(hitRate),
      keywordHits: flat.keywordHits,
      keywordMisses: flat.keywordMisses,
      forbiddenHits: flat.forbiddenHits,
      detail: `关键点 ${flat.keywordHits.length}/${evalCase.expectedKeywords.length || 0}；禁用表述 ${flat.forbiddenHits.length} 个`,
    },
    cosine,
    judge: {
      enabled: judgeInput.enabled,
      score: judgeScore,
      reason: judgeInput.reason,
      prompt: judgeInput.prompt,
      provider: judgeInput.provider ?? null,
      model: judgeInput.model ?? null,
      error: judgeInput.error ?? null,
    },
    human: {
      enabled: humanEnabled,
      scores: evalCase.humanScores,
      score: human.score,
      weight: humanWeight,
      weighted: round(humanWeighted),
      details: human.details,
    },
    calculation,
    issues: [reason, ...flat.riskIssues].filter(Boolean),
    runCreatedAt: run.createdAt,
    stepCount: run.steps.length,
    plannerSummary: run.plan?.goal
      ? `${run.plan.goal} · Skills: ${(run.plan.selectedSkills ?? []).join(', ') || '—'} · Tools: ${(run.plan.selectedTools ?? []).join(', ') || '—'}`
      : '无 Planner 摘要',
    source: evalCase.humanScores ? 'annotation' : evalCase.sourceRunId ? 'run' : 'manual',
    sourceLabel: evalCase.humanScores ? '人工标注' : evalCase.sourceRunId ? 'Run 导入' : '手工用例',
  };
}
