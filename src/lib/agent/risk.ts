import type { RiskResult, RiskViolation } from '@/lib/schemas';
import type { InputSignals } from './signals';

export type ToolResultSnapshot = {
  toolId: string;
  status: 'SUCCESS' | 'ERROR';
  input?: unknown;
  output?: unknown;
  error?: string;
};

const DEFAULT_SAFE_REPLY =
  '这次请求没有通过必要的安全校验，我不会继续自动处理。请稍后重试，或转人工进一步核实。';

const FRAUD_SAFE_REPLY =
  '这很可能是诈骗。请不要转账、不要提供验证码、银行卡密码或身份证信息，也不要点击陌生链接或共享屏幕。请通过 SnackOps 官方渠道核实订单；如已产生损失，建议立即联系平台并报警。';

const ALLERGY_SAFE_REPLY =
  '这款商品涉及过敏原或特殊人群风险，不能仅凭商品页保证安全。请先不要购买或食用，建议转人工核对具体批次和配料后再决定。';

const COMPLAINT_SAFE_REPLY =
  '很抱歉给你带来困扰。这个情况需要人工进一步核实，我先为你转接，不会要求你自行联系快递或反复重复描述。';

function addViolation(
  violations: RiskViolation[],
  ruleId: string,
  rule: string,
  reason: string,
  evidence: string,
  severity: RiskViolation['severity'] = 'blocking',
): void {
  violations.push({ ruleId, rule, severity, evidence, reason });
}

function collectNumbers(value: unknown, target: Set<number>): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    target.add(Math.round(value * 100) / 100);
    return;
  }
  if (typeof value === 'string') {
    for (const match of value.matchAll(/(\d+(?:\.\d{1,2})?)/g)) {
      target.add(Number(match[1]));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, target);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectNumbers(item, target);
  }
}

function candidateAmounts(candidate: string): number[] {
  const amounts: number[] = [];
  for (const match of candidate.matchAll(/(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*元/g)) {
    const raw = match[1] ?? match[2];
    if (raw) amounts.push(Number(raw));
  }
  return amounts;
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function evaluateCandidateRisk(input: {
  signals: InputSignals;
  candidateReply: string;
  toolResults: ToolResultSnapshot[];
}): RiskResult {
  const { signals, candidateReply, toolResults } = input;
  const candidate = candidateReply.trim();
  const sanitized = candidate.replace(/不能保证|无法保证|不保证|不会|不要|不能|无法|并非|不是/g, '');
  const violations: RiskViolation[] = [];
  const flags = [...signals.risk.flags];
  const notes: string[] = [];

  const allowedAmounts = new Set<number>();
  for (const result of toolResults) {
    collectNumbers(result.output, allowedAmounts);
  }
  if (signals.budget !== null) allowedAmounts.add(Math.round(signals.budget * 100) / 100);
  for (const amount of candidateAmounts(signals.input)) {
    allowedAmounts.add(amount);
  }

  // R01 价格一致性
  const amountMentions = candidateAmounts(candidate);
  if (amountMentions.length > 0 && allowedAmounts.size > 0) {
    const mismatch = amountMentions.find(
      (amount) => ![...allowedAmounts].some((allowed) => Math.abs(allowed - amount) < 0.011),
    );
    if (mismatch !== undefined) {
      addViolation(
        violations,
        'R01',
        '价格一致性',
        `回复中的金额 ${mismatch} 元没有对应的工具依据`,
        candidate.slice(0, 160),
      );
    }
  }

  // R02 极限词与夸大功效
  if (
    /全网最低|全网最好|最好吃|第一品牌|绝对安全|百分百|100%|零风险|包治|治愈|治疗|预防疾病|降血糖|降血压|绝对不过敏/.test(
      sanitized,
    )
  ) {
    addViolation(
      violations,
      'R02',
      '禁止极限词和夸大功效',
      '回复包含无法核验的绝对化或功效性表述',
      candidate.slice(0, 160),
    );
  }

  // R03 售后承诺边界
  if (
    /保证退款|一定退款|无条件退款|全额赔偿|立刻退款|马上退款|保证补发|一定补发|承诺兑奖|保证兑奖/.test(
      sanitized,
    )
  ) {
    addViolation(
      violations,
      'R03',
      '不做超出售后政策的承诺',
      '回复对退款、补发或兑奖结果作出了超出政策的保证',
      candidate.slice(0, 160),
    );
  }

  // R04 新客优惠判断
  if (signals.newCustomer && /新客|新人|首单/.test(candidate)) {
    const couponEvidence = toolResults.some(
      (result) => result.toolId === 'query_coupons' && result.status === 'SUCCESS',
    );
    if (!couponEvidence) {
      addViolation(
        violations,
        'R04',
        '新客优惠判断',
        '回复提及新客优惠，但本次没有优惠券核验结果',
        candidate.slice(0, 160),
        'warning',
      );
    }
  }

  // R05 特殊人群安全
  if (signals.allergy || signals.specialPopulation) {
    const hasSafety = hasAny(candidate, [
      /过敏/,
      /配料/,
      /可能含/,
      /谨慎/,
      /人工/,
      /核实/,
      /不要购买/,
      /不要食用/,
    ]);
    if (!hasSafety) {
      addViolation(
        violations,
        'R05',
        '儿童、孕妇、过敏和特殊人群安全提示',
        '回复缺少过敏原或特殊人群安全提示',
        candidate.slice(0, 160),
      );
    }
    if (/放心吃|可以放心|保证不过敏|绝对不过敏|不会过敏/.test(sanitized)) {
      addViolation(
        violations,
        'R05',
        '儿童、孕妇、过敏和特殊人群安全提示',
        '回复对过敏风险作出安全保证',
        candidate.slice(0, 160),
      );
    }
  }

  // R06 投诉与售后不推诿
  if (signals.complaint) {
    if (/不关我们|自己找快递|不是我们的问题|不负责|拒绝受理|无法处理/.test(sanitized)) {
      addViolation(
        violations,
        'R06',
        '投诉和售后不能推诿',
        '回复把责任推给用户、快递或平台，拒绝受理',
        candidate.slice(0, 160),
      );
    } else if (!/人工|核实|处理|反馈|转接|抱歉|理解/.test(candidate)) {
      addViolation(
        violations,
        'R06',
        '投诉和售后不能推诿',
        '投诉场景缺少人工接管或核实动作',
        candidate.slice(0, 160),
        'warning',
      );
    }
  }

  // R07 疑似中奖诈骗
  if (signals.fraud) {
    const dangerousInstruction =
      /(?:请|需要|马上|立即|直接)(?:你)?(?:转账|提供验证码|提供银行卡密码|开启屏幕共享)|点击.{0,24}(?:链接|网址).{0,24}(?:领奖|兑奖)|承诺兑奖|保证兑奖|立即兑奖/.test(
        candidate,
      );
    if (dangerousInstruction) {
      addViolation(
        violations,
        'R07',
        '疑似中奖诈骗',
        '回复引导转账、索取敏感信息或承诺兑奖',
        candidate.slice(0, 160),
      );
    }
    const safeSignals = [
      /不要转账/,
      /不要提供/,
      /验证码/,
      /敏感信息/,
      /官方渠道/,
      /报警/,
      /不要点击/,
      /核实/,
    ].filter((pattern) => pattern.test(candidate)).length;
    if (safeSignals < 2) {
      addViolation(
        violations,
        'R07',
        '疑似中奖诈骗',
        '诈骗场景缺少“不转账、不提供敏感信息、官方核验”的安全提醒',
        candidate.slice(0, 160),
      );
    }
  }

  const blocking = violations.filter((violation) => violation.severity === 'blocking');
  const decision = blocking.length > 0 ? 'block' : 'allow';
  let safeReply: string | null = null;
  if (decision === 'block') {
    if (signals.fraud) safeReply = FRAUD_SAFE_REPLY;
    else if (signals.allergy || signals.specialPopulation) safeReply = ALLERGY_SAFE_REPLY;
    else if (signals.complaint) safeReply = COMPLAINT_SAFE_REPLY;
    else safeReply = DEFAULT_SAFE_REPLY;
  }

  const riskLevel = decision === 'block' ? 'high' : signals.risk.level;
  if (signals.risk.requiresHumanHandoff) {
    notes.push('输入涉及高风险场景，建议人工接管或跟进。');
  }
  if (decision === 'allow') {
    notes.push('候选回复未命中阻断规则，可以发送。');
  }

  return {
    decision,
    riskLevel,
    flags: [...new Set(flags)],
    violations,
    safeReply,
    handoffRequired: signals.risk.requiresHumanHandoff || decision === 'block',
    checkedBy: 'risk-check.rules.v1',
    notes,
  };
}

export function blockedRiskResult(input: {
  signals: InputSignals;
  reason: string;
  ruleId?: string;
}): RiskResult {
  const { signals, reason, ruleId = 'R00' } = input;
  const safeReply = signals.fraud
    ? FRAUD_SAFE_REPLY
    : signals.allergy || signals.specialPopulation
      ? ALLERGY_SAFE_REPLY
      : signals.complaint
        ? COMPLAINT_SAFE_REPLY
        : DEFAULT_SAFE_REPLY;

  return {
    decision: 'block',
    riskLevel: 'high',
    flags: signals.risk.flags,
    violations: [
      {
        ruleId,
        rule: '执行前置条件',
        severity: 'blocking',
        evidence: reason.slice(0, 200),
        reason,
      },
    ],
    safeReply,
    handoffRequired: true,
    checkedBy: 'risk-check.plan-guard.v1',
    notes: ['计划或执行未满足前置条件，未发送未经审核的候选回复。'],
  };
}

export { DEFAULT_SAFE_REPLY, FRAUD_SAFE_REPLY, ALLERGY_SAFE_REPLY, COMPLAINT_SAFE_REPLY };
