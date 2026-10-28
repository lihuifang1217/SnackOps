import type { PlanRisk } from '@/lib/schemas';

export type AgentScenario =
  | 'fraud'
  | 'complaint'
  | 'allergy'
  | 'price'
  | 'order_logistics'
  | 'recommendation'
  | 'general';

export type InputSignals = {
  input: string;
  price: boolean;
  order: boolean;
  logistics: boolean;
  recommendation: boolean;
  allergy: boolean;
  specialPopulation: boolean;
  complaint: boolean;
  fraud: boolean;
  newCustomer: boolean;
  scenario: AgentScenario;
  orderNo: string | null;
  trackingNo: string | null;
  productId: string | null;
  couponCode: string | null;
  activityId: string | null;
  quantity: number | null;
  budget: number | null;
  requiredSkills: string[];
  requiredTools: string[];
  requiredCapabilities: string[];
  risk: PlanRisk;
};

function firstMatch(input: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[0]) return match[0];
  }
  return null;
}

function extractOrderNo(input: string): string | null {
  return firstMatch(input, [/\bSN\d{8,}\b/i, /\border-\d{8}-\d{3}\b/i]);
}

function extractTrackingNo(input: string): string | null {
  return firstMatch(input, [/\b(?:SF|ZT|YT|JD)[A-Z0-9]{8,}\b/i]);
}

function extractCouponCode(input: string): string | null {
  const candidates = input.match(/\b[A-Z]{3,}[A-Z0-9]{0,8}\b/g) ?? [];
  return (
    candidates.find(
      (code) =>
        /\d/.test(code) &&
        !/^SN\d+$/.test(code) &&
        !/^(SF|ZT|YT|JD)[A-Z0-9]+$/.test(code),
    ) ?? null
  );
}

function extractQuantity(input: string): number | null {
  const match = input.match(/(?:买|要|来|下|购买)\s*(\d+)\s*(?:份|包|袋|盒|件|个)?/);
  if (match?.[1]) return Number(match[1]);
  const unitMatch = input.match(/(\d+)\s*(?:份|包|袋|盒|件|个)/);
  return unitMatch?.[1] ? Number(unitMatch[1]) : null;
}

const ALLERGY_TERM_PATTERN = /过敏|花生|核桃|巴旦木|腰果|乳制品|小麦|大豆|芝麻|鸡蛋|海鲜|忌口/gi;

/**
 * 识别“无过敏 / 没有过敏 / 不过敏 / 没有花生过敏”等否定表达。
 * Planner 的风险信号不能只做子串匹配，否则“无过敏”会被误判为过敏高风险。
 */
function hasPositiveAllergySignal(input: string): boolean {
  // 按句读拆分，避免“无过敏史，但对花生过敏”这类跨句误判。
  for (const clause of input.split(/[，。；,;!?！？\n]/)) {
    for (const match of clause.matchAll(ALLERGY_TERM_PATTERN)) {
      const index = match.index ?? 0;
      const before = clause.slice(0, index);
      const after = clause.slice(index + match[0].length);
      const negatedBefore = /(?:无|没有|没|不|无需|不用|不必|不含|未|从未)/.test(before);
      const negatedAfter = /^(?:也|并|都)?(?:不|无|没)/.test(after);
      if (negatedBefore || negatedAfter) continue;
      return true;
    }
  }
  return false;
}

function extractBudget(input: string): number | null {
  const match =
    input.match(/(?:预算|不超过|控制在|以内|低于)\s*(\d+(?:\.\d+)?)/) ??
    input.match(/(\d+(?:\.\d+)?)\s*元(?:以内|预算)/);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function detectInputSignals(input: string): InputSignals {
  const normalized = input.trim();
  const orderNo = extractOrderNo(normalized);
  const trackingNo = extractTrackingNo(normalized);
  const productId = firstMatch(normalized, [/\bprod-\d+\b/i]);
  const couponCode = extractCouponCode(normalized);
  const activityId = firstMatch(normalized, [/\bact-\d+\b/i]);
  const quantity = extractQuantity(normalized);
  const budget = extractBudget(normalized);

  const fraud = /中奖|兑奖|诈骗|骗子|验证码|转账|保证金|屏幕共享|银行卡|陌生链接|退款客服|安全账户|解冻/i.test(normalized);
  const complaint = /投诉|差评|赔偿|太差|很失望|生气|不满意|变质|过期|异味|异物|身体不适|肚子疼|拉肚子|食品安全|吃坏/i.test(normalized);
  const specialPopulation = /儿童|孩子|小孩|宝宝|孕妇|怀孕|哺乳|婴儿|老人|特殊人群/i.test(normalized);
  const allergy = hasPositiveAllergySignal(normalized) || specialPopulation;
  const price =
    /多少钱|价格|总价|合计|折后|优惠后|计算价格|帮我算|满减|优惠券|券后/i.test(normalized) ||
    Boolean(couponCode) ||
    (/\d+\s*元/.test(normalized) && /优惠|减|券|活动/.test(normalized));
  const logistics =
    /物流|快递|运单|到哪|派送|签收|运输|发货|顺丰|中通|圆通|京东物流/i.test(normalized) ||
    Boolean(trackingNo);
  const order = /订单|单号|购买记录|order-/i.test(normalized) || Boolean(orderNo);
  const recommendation =
    !price &&
    !order &&
    !logistics &&
    !fraud &&
    /推荐|买点|买什么|零食|送礼|同事|办公室|口味|预算|礼包|下午茶|追剧/i.test(normalized);
  const newCustomer = /新客|新人|首单|第一次买|首次下单/i.test(normalized);

  const flags: string[] = [];
  const notes: string[] = [];
  if (fraud) {
    flags.push('fraud_suspected');
    notes.push('用户描述疑似中奖或退款诈骗，必须提醒不要转账、不要提供验证码，并通过官方渠道核验。');
  }
  if (complaint) {
    flags.push('complaint_or_food_safety');
    notes.push('用户存在投诉或食品安全风险，不能推诿，应建议人工跟进。');
  }
  if (allergy) {
    flags.push('allergy_or_special_population');
    notes.push('用户涉及过敏原或特殊人群，需要基于真实配料与可能含有信息提示，不能保证绝对安全。');
  }
  if (specialPopulation) flags.push('special_population');
  if (price) flags.push('price_sensitive');
  if (order) flags.push('order_lookup');
  if (logistics) flags.push('logistics_lookup');
  if (recommendation) flags.push('recommendation');
  if (newCustomer) flags.push('new_customer');

  let level: PlanRisk['level'] = 'low';
  if (fraud || complaint || (allergy && specialPopulation)) level = 'high';
  else if (allergy) level = 'medium';

  const requiredSkills = ['need-extraction', 'response-generator', 'risk-check'];
  const requiredTools: string[] = [];

  if (fraud) requiredSkills.push('human-handoff-decision');
  if (complaint) requiredSkills.push('complaint-triage', 'human-handoff-decision');
  if (allergy) requiredSkills.push('allergy-risk-reminder', 'human-handoff-decision');
  if (recommendation) requiredSkills.push('recommendation-decision', 'recommendation-reason');

  if (price) {
    requiredTools.push('query_products', 'query_activities', 'query_coupons', 'calculate_price');
  } else if (recommendation) {
    requiredTools.push('query_products');
  }
  if (allergy) requiredTools.push('query_products');
  if (order) requiredTools.push('query_orders');
  if (logistics) requiredTools.push('query_logistics');

  let scenario: AgentScenario = 'general';
  if (fraud) scenario = 'fraud';
  else if (complaint) scenario = 'complaint';
  else if (allergy) scenario = 'allergy';
  else if (price) scenario = 'price';
  else if (order || logistics) scenario = 'order_logistics';
  else if (recommendation) scenario = 'recommendation';

  const uniqueSkills = [...new Set(requiredSkills)];
  const uniqueTools = [...new Set(requiredTools)];

  return {
    input: normalized,
    price,
    order,
    logistics,
    recommendation,
    allergy,
    specialPopulation,
    complaint,
    fraud,
    newCustomer,
    scenario,
    orderNo,
    trackingNo,
    productId,
    couponCode,
    activityId,
    quantity,
    budget,
    requiredSkills: uniqueSkills,
    requiredTools: uniqueTools,
    requiredCapabilities: [
      ...uniqueSkills.map((id) => `skill:${id}`),
      ...uniqueTools.map((id) => `tool:${id}`),
    ],
    risk: {
      level,
      flags: [...new Set(flags)],
      requiresHumanHandoff: fraud || complaint || allergy,
      notes,
    },
  };
}

export function normalizeMandatoryCapabilities(
  values: string[],
  availableSkillIds: string[],
  availableToolIds: string[],
): string[] {
  const skillSet = new Set(availableSkillIds);
  const toolSet = new Set(availableToolIds);
  const normalized: string[] = [];

  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    if (value.startsWith('skill:')) {
      normalized.push(`skill:${value.slice(6)}`);
      continue;
    }
    if (value.startsWith('tool:')) {
      normalized.push(`tool:${value.slice(5)}`);
      continue;
    }
    if (toolSet.has(value)) {
      normalized.push(`tool:${value}`);
    } else if (skillSet.has(value)) {
      normalized.push(`skill:${value}`);
    } else {
      normalized.push(`skill:${value}`);
    }
  }

  return [...new Set(normalized)];
}
