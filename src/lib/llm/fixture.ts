import type { AgentPlan, Product } from '@/lib/schemas';
import type { ProviderSelectionInfo } from '@/lib/types';
import {
  ALLERGY_SAFE_REPLY,
  COMPLAINT_SAFE_REPLY,
  FRAUD_SAFE_REPLY,
} from '@/lib/agent/risk';
import type { FixtureContext, LlmClient, LlmGenerateRequest, LlmGeneration } from './types';

type ProductOutput = { items?: Product[]; total?: number };
type PriceOutput = {
  currency?: string;
  lines?: { name?: string; quantity?: number; lineTotal?: number }[];
  subtotal?: number;
  activityDiscount?: number;
  couponDiscount?: number;
  total?: number;
  appliedActivity?: { name?: string } | null;
  appliedCoupon?: { code?: string; name?: string } | null;
  notes?: string[];
};
type OrderOutput = {
  items?: {
    orderNo?: string;
    status?: string;
    logisticsStatus?: string;
    afterSalesStatus?: string;
    itemSummary?: string;
    userName?: string;
    logistics?: {
      carrier?: string;
      trackingNo?: string;
      status?: string;
      latestEvent?: string;
    } | null;
  }[];
};
type LogisticsOutput = {
  items?: {
    carrier?: string;
    trackingNo?: string;
    status?: string;
    latestEvent?: string;
    orderNo?: string;
    events?: { at?: string; description?: string }[];
  }[];
};

const ALLERGEN_TERMS = [
  '花生',
  '坚果',
  '核桃',
  '巴旦木',
  '腰果',
  '小麦',
  '乳制品',
  '大豆',
  '芝麻',
  '鸡蛋',
  '鱼类',
  '海鲜',
];

function toolOutput(ctx: FixtureContext, toolId: string): unknown {
  return ctx.toolResults?.find((result) => result.toolId === toolId)?.output;
}

function toolError(ctx: FixtureContext, toolId: string): string | null {
  const result = ctx.toolResults?.find((item) => item.toolId === toolId);
  return result?.status === 'ERROR' ? result.error ?? '工具执行失败' : null;
}

function asProductOutput(value: unknown): ProductOutput {
  return value && typeof value === 'object' ? (value as ProductOutput) : {};
}

function asPriceOutput(value: unknown): PriceOutput {
  return value && typeof value === 'object' ? (value as PriceOutput) : {};
}

function asOrderOutput(value: unknown): OrderOutput {
  return value && typeof value === 'object' ? (value as OrderOutput) : {};
}

function asLogisticsOutput(value: unknown): LogisticsOutput {
  return value && typeof value === 'object' ? (value as LogisticsOutput) : {};
}

function requestedAllergens(input: string): string[] {
  return ALLERGEN_TERMS.filter((term) => input.includes(term));
}

function filteredProducts(ctx: FixtureContext): Product[] {
  const products = asProductOutput(toolOutput(ctx, 'query_products')).items ?? [];
  const allergens = requestedAllergens(ctx.userInput);
  return products.filter((product) => {
    if (ctx.signals.budget !== null && product.price > ctx.signals.budget) return false;
    if (/不辣|不吃辣/.test(ctx.userInput) && /辣/.test(`${product.flavor} ${product.tags.join(' ')}`)) {
      return false;
    }
    if (allergens.length > 0) {
      const productAllergens = [...product.allergens, ...product.mayContain].join(' ');
      if (allergens.some((allergen) => productAllergens.includes(allergen))) return false;
    }
    return true;
  });
}

function mandatoryParts(ctx: FixtureContext): { skills: string[]; tools: string[]; raw: string[] } {
  const skills: string[] = [];
  const tools: string[] = [];
  for (const raw of ctx.mandatoryCapabilities) {
    if (raw.startsWith('skill:')) skills.push(raw.slice(6));
    else if (raw.startsWith('tool:')) tools.push(raw.slice(5));
  }
  return { skills, tools, raw: ctx.mandatoryCapabilities };
}

function fixturePlan(ctx: FixtureContext): AgentPlan {
  const availableSkillIds = new Set(ctx.availableSkills.map((skill) => skill.id));
  const availableToolIds = new Set(ctx.availableTools.map((tool) => tool.id));
  const mandatory = mandatoryParts(ctx);
  const missing = mandatory.raw.filter((raw) => {
    if (raw.startsWith('skill:')) return !availableSkillIds.has(raw.slice(6));
    if (raw.startsWith('tool:')) return !availableToolIds.has(raw.slice(5));
    return true;
  });

  const requiredSkillIds = mandatory.skills.filter((id) => availableSkillIds.has(id));
  const requiredToolIds = mandatory.tools.filter((id) => availableToolIds.has(id));
  const orderedSkills: string[] = [];
  const addSkill = (id: string) => {
    if (availableSkillIds.has(id) && !orderedSkills.includes(id)) orderedSkills.push(id);
  };

  const requiredSet = new Set(requiredSkillIds);
  const scenarioOrder = [
    'need-extraction',
    'human-handoff-decision',
    'complaint-triage',
    'allergy-risk-reminder',
    'recommendation-decision',
    'recommendation-reason',
  ];
  for (const id of scenarioOrder) {
    if (requiredSet.has(id)) addSkill(id);
  }
  for (const id of requiredSkillIds) addSkill(id);
  addSkill('response-generator');
  addSkill('risk-check');

  const orderedTools: string[] = [];
  const addTool = (id: string) => {
    if (availableToolIds.has(id) && !orderedTools.includes(id)) orderedTools.push(id);
  };
  for (const id of requiredToolIds) addTool(id);
  if (ctx.signals.recommendation && !ctx.signals.price) {
    addTool('query_products');
    addTool('query_activities');
    addTool('query_coupons');
  }

  const goalByScenario: Record<typeof ctx.signals.scenario, string> = {
    fraud: '识别疑似中奖诈骗并生成安全提醒',
    complaint: '安抚投诉并判断人工接管',
    allergy: '核对过敏原并给出特殊人群安全提醒',
    price: '使用真实活动和优惠券试算价格',
    order_logistics: '查询订单与物流状态',
    recommendation: '基于真实商品与偏好生成零食推荐',
    general: '理解问题并生成可核验的客服回复',
  };

  return {
    goal: goalByScenario[ctx.signals.scenario],
    selectedSkills: orderedSkills,
    selectedTools: orderedTools,
    reasoning: [
      `识别场景为 ${ctx.signals.scenario}。`,
      ctx.signals.price ? '价格场景必须调用 calculate_price。' : '',
      ctx.signals.order ? '订单场景必须调用 query_orders。' : '',
      ctx.signals.logistics ? '物流场景必须调用 query_logistics。' : '',
      ctx.signals.fraud ? '疑似诈骗场景必须执行风险检查与人工接管决策。' : '',
      `已选择的 Skill 均来自当前启用清单，共 ${orderedSkills.length} 个；Tool 共 ${orderedTools.length} 个。`,
    ]
      .filter(Boolean)
      .join(' '),
    mandatoryCapabilities: mandatory.raw,
    risk: ctx.signals.risk,
    fallback:
      missing.length > 0
        ? {
            required: true,
            reason: `当前启用的能力无法满足强制依赖：${missing.join('、')}`,
          }
        : ctx.signals.risk.requiresHumanHandoff
          ? {
              required: false,
              reason: '高风险场景，将在执行后转入人工跟进',
            }
          : null,
  };
}

function planJson(ctx: FixtureContext): string {
  return JSON.stringify(fixturePlan(ctx), null, 2);
}

function extractionJson(ctx: FixtureContext): string {
  return JSON.stringify(
    {
      intent: ctx.signals.scenario,
      productPreferences: {
        categories: ctx.signals.recommendation ? ['零食'] : [],
        flavors: /不辣/.test(ctx.userInput) ? ['不辣'] : [],
        tags: /办公室/.test(ctx.userInput) ? ['办公室'] : [],
        budget: ctx.signals.budget,
        quantity: ctx.signals.quantity,
        scenario: /同事/.test(ctx.userInput) ? '同事分享' : null,
      },
      safetyConstraints: {
        allergens: requestedAllergens(ctx.userInput),
        specialPopulation: /儿童|孩子|宝宝|孕妇|哺乳|老人/.test(ctx.userInput)
          ? ['特殊人群']
          : [],
        avoidIngredients: [],
      },
      orderReferences: {
        orderNo: ctx.signals.orderNo,
        trackingNo: ctx.signals.trackingNo,
        productNames: [],
      },
      riskFlags: ctx.signals.risk.flags,
      missingInfo: ctx.signals.order && !ctx.signals.orderNo ? ['订单号'] : [],
      nextAction: ctx.signals.scenario,
      summary: ctx.userInput.slice(0, 80),
    },
    null,
    2,
  );
}

function recommendationDecisionJson(ctx: FixtureContext): string {
  const products = filteredProducts(ctx).slice(0, 2);
  return JSON.stringify(
    {
      status: products.length > 0 ? 'matched' : 'no_safe_match',
      recommendations: products.map((product) => ({
        productId: product.id,
        name: product.name,
        price: product.price,
        flavor: product.flavor,
        tags: product.tags,
        matchReasons: [
          ctx.signals.budget !== null ? `价格在 ${ctx.signals.budget} 元预算内` : '价格信息来自商品数据',
          /办公室/.test(ctx.userInput) && product.tags.includes('办公室') ? '适合办公室场景' : '口味与需求接近',
        ],
        caution: [...product.allergens, ...product.mayContain].length
          ? `配料与过敏原：${[...product.allergens, ...product.mayContain].join('、')}`
          : null,
      })),
      excludedCount: Math.max(
        0,
        (asProductOutput(toolOutput(ctx, 'query_products')).items?.length ?? 0) - products.length,
      ),
      safetyNote:
        requestedAllergens(ctx.userInput).length > 0
          ? '已根据用户提到的过敏原过滤候选商品，仍需人工确认批次信息。'
          : null,
      nextAction: products.length > 0 ? 'recommendation_reason' : 'clarify',
    },
    null,
    2,
  );
}

function recommendationReasonJson(ctx: FixtureContext): string {
  const products = filteredProducts(ctx).slice(0, 2);
  return JSON.stringify(
    {
      reasons: products.map((product) => ({
        productId: product.id,
        text: `${product.name}售价 ${product.price.toFixed(2)} 元，${product.flavor}，${product.tags.slice(0, 2).join('、')}。`,
        evidence: [`price:${product.price}`, `flavor:${product.flavor}`, ...product.tags.slice(0, 2).map((tag) => `tag:${tag}`)],
      })),
      safetyReminder:
        products.length > 0
          ? `商品可能含有的过敏原信息：${products
              .flatMap((product) => [...product.allergens, ...product.mayContain])
              .filter((item, index, list) => list.indexOf(item) === index)
              .join('、') || '无'}`
          : null,
    },
    null,
    2,
  );
}

function responseJson(ctx: FixtureContext, reply: string, handoff = false, reason: string | null = null): string {
  return JSON.stringify(
    {
      reply,
      citations: (ctx.toolResults ?? []).map((result) => `${result.toolId}:${result.status}`),
      nextAction: handoff ? 'human_handoff' : 'none',
      handoffReason: reason,
    },
    null,
    2,
  );
}

function priceReply(ctx: FixtureContext): string {
  const price = asPriceOutput(toolOutput(ctx, 'calculate_price'));
  if (toolError(ctx, 'calculate_price') || price.total === undefined) {
    return '价格试算没有成功，我不会猜测金额。请补充商品、数量和优惠券信息，或转人工进一步核对。';
  }

  const lines = (price.lines ?? [])
    .map((line) => `${line.name ?? '商品'} × ${line.quantity ?? 1}，小计 ${Number(line.lineTotal ?? 0).toFixed(2)} 元`)
    .join('；');
  const activity = price.appliedActivity?.name ? `活动「${price.appliedActivity.name}」减 ${Number(price.activityDiscount ?? 0).toFixed(2)} 元` : '未应用活动';
  const coupon = price.appliedCoupon?.code ? `优惠券 ${price.appliedCoupon.code} 减 ${Number(price.couponDiscount ?? 0).toFixed(2)} 元` : '未使用优惠券';

  return `按当前商品数据试算：${lines}。原价 ${Number(price.subtotal ?? 0).toFixed(2)} 元，${activity}，${coupon}，合计 ${Number(price.total).toFixed(2)} 元。以上是试算结果，未创建订单。`;
}

function orderLogisticsReply(ctx: FixtureContext): string {
  const orders = asOrderOutput(toolOutput(ctx, 'query_orders')).items ?? [];
  const logistics = asLogisticsOutput(toolOutput(ctx, 'query_logistics')).items ?? [];
  const orderError = toolError(ctx, 'query_orders');
  const logisticsError = toolError(ctx, 'query_logistics');
  const parts: string[] = [];

  if (orderError) parts.push('订单查询暂时失败，我不会假设订单一定存在。请核对订单号后再试，或转人工。');
  else if (orders.length > 0) {
    const order = orders[0];
    parts.push(
      `订单 ${order.orderNo ?? ctx.signals.orderNo ?? ''} 当前状态为「${order.status ?? '未知'}」，物流状态「${order.logisticsStatus ?? '未知'}」，售后状态「${order.afterSalesStatus ?? '无'}」。`,
    );
  } else {
    parts.push('没有查询到匹配订单，请核对订单号。');
  }

  if (logisticsError) parts.push('物流查询暂时失败，请不要据此判断包裹状态，我会转人工继续核对。');
  else if (logistics.length > 0) {
    const item = logistics[0];
    parts.push(
      `${item.carrier ?? '承运商'} 运单 ${item.trackingNo ?? ''} 最新状态为「${item.status ?? '未知'}」：${item.latestEvent ?? '暂无更新'}。`,
    );
  }

  if (ctx.signals.allergy) {
    parts.push('如涉及过敏或特殊人群食用安全，请转人工确认具体批次；不要仅凭物流状态判断商品安全。');
  }
  return parts.join('\n\n');
}

function allergyReply(ctx: FixtureContext): string {
  const product = asProductOutput(toolOutput(ctx, 'query_products')).items?.[0];
  if (!product) {
    return '目前无法从商品数据确认过敏原信息。请不要仅凭经验判断，建议转人工核对配料和批次后再决定。';
  }
  return `根据商品数据，${product.name} 的配料包含 ${product.ingredients.join('、')}；明确过敏原为 ${product.allergens.join('、') || '无'}，可能含有 ${product.mayContain.join('、') || '无'}。商品页无法排除生产线交叉接触，无法保证对过敏人群安全。若涉及儿童、孕妇或严重过敏，请先不要购买或食用，建议转人工进一步核实。`;
}

function recommendationReply(ctx: FixtureContext): string {
  const products = filteredProducts(ctx).slice(0, 2);
  if (products.length === 0) {
    return '目前没有找到同时满足预算、口味和安全约束的商品。请补充可接受的品类或预算；如果涉及过敏原，建议转人工核对。';
  }
  const lines = products
    .map((product) => `${product.name}，${product.price.toFixed(2)} 元，${product.flavor}，标签：${product.tags.slice(0, 2).join('、')}`)
    .join('；');
  const allergies = products
    .flatMap((product) => [...product.allergens, ...product.mayContain])
    .filter((item, index, list) => list.indexOf(item) === index);
  return `可以看看这几款：${lines}。${allergies.length > 0 ? `需要注意，相关商品含有的过敏原或可能含有信息包括：${allergies.join('、')}。` : ''}如果涉及儿童、孕妇或明确过敏，建议先转人工确认配料和批次。以上价格来自当前商品数据，实际优惠以结算页为准。`;
}

function complaintReply(): string {
  return COMPLAINT_SAFE_REPLY;
}

function genericReply(ctx: FixtureContext): string {
  if (ctx.signals.orderNo) {
    return `我看到了订单号 ${ctx.signals.orderNo}。为了准确回答，需要同时核对订单和物流数据；如果查询失败，我会转人工，不会猜测结果。`;
  }
  return '我理解你的问题。请补充具体商品、订单号或使用场景，我可以继续核对；涉及过敏、投诉或疑似诈骗时会立即转人工或给出安全提醒。';
}

function responseGeneratorJson(ctx: FixtureContext): string {
  let reply: string;
  let handoff = ctx.signals.risk.requiresHumanHandoff;
  let reason: string | null = handoff ? '输入涉及高风险场景' : null;

  if (ctx.signals.fraud) {
    return responseJson(ctx, FRAUD_SAFE_REPLY, true, '疑似中奖诈骗');
  }
  if (ctx.signals.complaint) {
    return responseJson(ctx, complaintReply(), true, '投诉或食品安全风险');
  }
  if (ctx.signals.order || ctx.signals.logistics) {
    reply = orderLogisticsReply(ctx);
    if (toolError(ctx, 'query_orders') || toolError(ctx, 'query_logistics')) {
      handoff = true;
      reason = '订单或物流工具失败';
    }
  } else if (ctx.signals.price) {
    reply = priceReply(ctx);
    if (toolError(ctx, 'calculate_price')) {
      handoff = true;
      reason = '价格试算失败';
    }
  } else if (ctx.signals.allergy) {
    reply = allergyReply(ctx);
    handoff = true;
    reason = '过敏或特殊人群需要人工核实';
  } else if (ctx.signals.recommendation) {
    reply = recommendationReply(ctx);
  } else {
    reply = genericReply(ctx);
  }

  return responseJson(ctx, reply, handoff, reason);
}

function skillOutputJson(ctx: FixtureContext): string {
  const skillId = ctx.skillId ?? '';
  switch (skillId) {
    case 'need-extraction':
      return extractionJson(ctx);
    case 'recommendation-decision':
      return recommendationDecisionJson(ctx);
    case 'recommendation-reason':
      return recommendationReasonJson(ctx);
    case 'response-generator':
      return responseGeneratorJson(ctx);
    case 'human-handoff-decision':
      return JSON.stringify(
        {
          handoff: ctx.signals.risk.requiresHumanHandoff,
          priority: ctx.signals.risk.level === 'high' ? 'critical' : 'normal',
          reasonCode: ctx.signals.fraud
            ? 'scam'
            : ctx.signals.allergy
              ? 'allergy'
              : ctx.signals.complaint
                ? 'complaint'
                : 'other',
          reason: ctx.signals.risk.notes.join('；') || '当前场景无需人工接管。',
          knownFacts: ctx.signals.risk.flags,
          missingInfo: ctx.signals.order && !ctx.signals.orderNo ? ['订单号'] : [],
          suggestedQueue: ctx.signals.fraud ? '安全核验' : '客服人工',
          userMessage: ctx.signals.fraud
            ? FRAUD_SAFE_REPLY
            : ctx.signals.allergy
              ? ALLERGY_SAFE_REPLY
              : ctx.signals.complaint
                ? COMPLAINT_SAFE_REPLY
                : '这个问题需要人工进一步核实，我会把你的描述一起转交。',
        },
        null,
        2,
      );
    case 'complaint-triage':
      return JSON.stringify(
        {
          level: ctx.signals.risk.level === 'high' ? 'P1' : 'P2',
          sentiment: 'frustrated',
          foodSafetyInvolved: /身体不适|肚子疼|拉肚子|食品安全/.test(ctx.userInput),
          handoffRequired: true,
          handoffPriority: ctx.signals.risk.level === 'high' ? 'high' : 'normal',
          evidenceGaps: ['订单号', '签收时间'],
          recommendedAction: '转人工核实订单与售后政策',
          replyGuidance: '先表达关切，不推诿，不承诺超政策赔偿',
        },
        null,
        2,
      );
    case 'allergy-risk-reminder': {
      const product = asProductOutput(toolOutput(ctx, 'query_products')).items?.[0];
      return JSON.stringify(
        {
          riskLevel: 'high',
          facts: {
            ingredients: product?.ingredients ?? [],
            allergens: product?.allergens ?? [],
            mayContain: product?.mayContain ?? [],
          },
          message: allergyReply(ctx),
          handoffRequired: true,
          handoffReason: '过敏原或特殊人群咨询',
        },
        null,
        2,
      );
    }
    case 'clarification-question':
      return JSON.stringify(
        {
          needsClarification: true,
          questions: [
            {
              field: ctx.signals.order ? 'orderNo' : 'requirements',
              question: ctx.signals.order
                ? '请提供订单号，我才能核对订单和物流状态。'
                : '请补充预算、口味或是否涉及过敏原。',
              options: [],
            },
          ],
          reason: '缺少执行所需的关键信息',
          canProceedWithoutAnswer: false,
        },
        null,
        2,
      );
    case 'product-substitution':
      return JSON.stringify(
        {
          status: filteredProducts(ctx).length > 0 ? 'substituted' : 'no_safe_match',
          alternatives: filteredProducts(ctx).slice(0, 2).map((product) => ({
            productId: product.id,
            name: product.name,
            price: product.price,
            caution: product.allergens.join('、') || null,
          })),
          safetyNote: '替代商品仍需核对过敏原和可能含有信息。',
        },
        null,
        2,
      );
    case 'conversation-summary':
      return JSON.stringify(
        {
          intent: ctx.signals.scenario,
          confirmedFacts: (ctx.toolResults ?? []).map((result) => `${result.toolId}:${result.status}`),
          risks: ctx.signals.risk.flags,
          unresolved: ctx.signals.order && !ctx.signals.orderNo ? ['订单号'] : [],
          nextSteps: ctx.signals.risk.requiresHumanHandoff ? ['转人工核实'] : ['继续自动处理'],
        },
        null,
        2,
      );
    case 'gift-scenario-advisor':
      return JSON.stringify(
        {
          ok: filteredProducts(ctx).length > 0,
          scenario: /同事/.test(ctx.userInput) ? '同事分享' : '送礼',
          budget: ctx.signals.budget,
          bundle: filteredProducts(ctx).slice(0, 2).map((product) => ({
            productId: product.id,
            name: product.name,
            quantity: 1,
            reason: product.tags.slice(0, 2).join('、'),
          })),
          allergenWarning: filteredProducts(ctx)
            .flatMap((product) => product.allergens)
            .filter((item, index, list) => list.indexOf(item) === index)
            .join('、'),
        },
        null,
        2,
      );
    case '对话问候-skill':
      return JSON.stringify(
        {
          reply: '你好，我是 SnackOps 零食客服助手。想找零食、查订单还是了解售后？',
          intentHint: 'greeting',
          offerHumanHandoff: false,
        },
        null,
        2,
      );
    default:
      return JSON.stringify(
        {
          status: 'completed',
          skillId,
          summary: `已根据 ${ctx.userInput.slice(0, 60)} 完成 ${ctx.skillName ?? skillId}。`,
          riskFlags: ctx.signals.risk.flags,
        },
        null,
        2,
      );
  }
}


function stableSlug(input: string): string {
  let hash = 0;
  for (const char of input) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash.toString(36).padStart(6, '0').slice(0, 6);
}

function inferTools(description: string, availableTools: FixtureContext['availableTools']): string[] {
  const available = new Set(availableTools.map((tool) => tool.id));
  const tools: string[] = [];
  const add = (id: string) => {
    if (available.has(id) && !tools.includes(id)) tools.push(id);
  };

  if (/价格|优惠|券|折扣|满减|金额|预算|多少钱|试算/.test(description)) {
    add('query_products');
    add('query_activities');
    add('query_coupons');
    add('calculate_price');
  }
  if (/商品|推荐|零食|口味|礼包|送礼|替代/.test(description)) add('query_products');
  if (/订单|购买记录|售后|退款|退货|少发|破损/.test(description)) add('query_orders');
  if (/物流|快递|运单|派送|发货/.test(description)) add('query_logistics');

  return tools;
}

function inferCategory(description: string): string {
  if (/风险|安全|诈骗|过敏|投诉/.test(description)) return '安全';
  if (/订单|物流|售后|退款/.test(description)) return '服务';
  if (/推荐|商品|礼品|口味/.test(description)) return '推荐';
  return '对话';
}

function skillDraftJson(ctx: FixtureContext): string {
  const description = ctx.userInput.trim();
  const name = description.slice(0, 16) || '自定义客服技能';
  const id = `custom-skill-${stableSlug(description)}`;
  const requiredTools = inferTools(description, ctx.availableTools);
  const triggerScenarios = [
    description,
    /订单|物流/.test(description) ? '用户提供订单号或物流单号' : '用户提出同类客服诉求',
    /过敏|儿童|孕妇/.test(description) ? '涉及过敏原或特殊人群' : '用户需要人工确认边界',
  ];
  const systemPrompt = `# ${name}

## 触发场景
- ${triggerScenarios[0]}
- ${triggerScenarios[1]}
- ${triggerScenarios[2]}

## 输入
- 用户问题与最近对话
- 已执行 Tool 的真实结果
- 当前 Planner 计划和上游 Skill 输出

## 指令
1. 先确认用户真实诉求和已提供的信息。
2. 只使用真实 Skill / Tool 数据，不编造订单、价格、过敏原或库存。
3. ${description}
4. 信息不足时提出一个关键澄清问题；无法确认时建议人工接管。
5. 输出必须可被后续回复生成与风险审核使用。

## 输出要求
- 使用简洁中文。
- 明确区分事实、推断和待确认信息。
- 不得承诺超出售后政策的退款、补发或赔偿。
- 涉及过敏、儿童、孕妇、投诉或诈骗时给出安全提醒。

## 安全边界
- 不提供医疗诊断或疗效承诺。
- 不索取验证码、银行卡密码，不引导转账或屏幕共享。
- 不伪造 Tool 结果或订单状态。`;

  return JSON.stringify(
    {
      id,
      name,
      description,
      category: inferCategory(description),
      model: 'snackops-fixture-v1',
      temperature: 0.2,
      maxTokens: 1200,
      requiredTools,
      systemPrompt,
      enabled: true,
      triggerScenarios,
      reviewNotes: [
        '这是课堂 fixture 生成的草稿，请在保存前人工审阅触发场景、工具依赖和安全边界。',
        requiredTools.length === 0
          ? '当前草案没有选择工具依赖；如果不需要真实业务数据可以保持为空。'
          : `已推断依赖工具：${requiredTools.join('、')}，保存前请确认。`,
      ],
    },
    null,
    2,
  );
}

function generationFrom(info: ProviderSelectionInfo, text: string): LlmGeneration {
  return {
    text,
    provider: 'classroom-fixture',
    model: info.model,
    isDemo: true,
  };
}

export function createFixtureClient(info: ProviderSelectionInfo): LlmClient {
  return {
    info,
    async generate(request: LlmGenerateRequest): Promise<LlmGeneration> {
      const context = request.fixture;
      const text =
        context.task === 'planner'
          ? planJson(context)
          : context.task === 'skill-draft'
            ? skillDraftJson(context)
            : skillOutputJson(context);
      return generationFrom(info, text);
    },
  };
}

