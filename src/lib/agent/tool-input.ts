import 'server-only';

import { readCollection } from '@/lib/store';
import type { Activity, Product } from '@/lib/schemas';
import type { ToolResultSnapshot } from './risk';
import type { InputSignals } from './signals';

export type DerivedToolInput = {
  input: unknown;
  error: string | null;
};

type ProductOutput = { items?: Product[] };
function productOutput(toolResults: ToolResultSnapshot[]): ProductOutput {
  const value = toolResults.find((result) => result.toolId === 'query_products')?.output;
  return value && typeof value === 'object' ? (value as ProductOutput) : {};
}

function mentionedProduct(products: Product[], input: string): Product | null {
  const candidates = products.flatMap((product) => [
    { product, term: product.name },
    { product, term: product.category },
    { product, term: product.flavor },
    ...product.tags.map((tag) => ({ product, term: tag })),
  ]);
  const matches = candidates
    .filter(({ term }) => term.length >= 2 && input.includes(term))
    .sort((left, right) => right.term.length - left.term.length);
  return matches[0]?.product ?? null;
}

function detectAllergenTerms(input: string, products: Product[]): string[] {
  const terms = new Set<string>();
  for (const product of products) {
    for (const allergen of [...product.allergens, ...product.mayContain]) {
      if (input.includes(allergen)) terms.add(allergen);
    }
  }
  return [...terms];
}

async function productsInput(signals: InputSignals): Promise<DerivedToolInput> {
  const products = await readCollection('products');
  const product = mentionedProduct(products, signals.input);
  const excludeAllergens = detectAllergenTerms(signals.input, products);
  return {
    input: {
      ...(product ? { keyword: product.category } : {}),
      ...(excludeAllergens.length > 0 ? { excludeAllergens } : {}),
      onlyInStock: true,
      limit: 8,
    },
    error: null,
  };
}

function activitiesInput(): DerivedToolInput {
  return {
    input: { activeOnly: true, limit: 10 },
    error: null,
  };
}

async function couponsInput(signals: InputSignals): Promise<DerivedToolInput> {
  const users = await readCollection('users');
  const userId = signals.input.match(/\buser-\d+\b/i)?.[0] ?? null;
  if (userId && !users.some((user) => user.id === userId)) {
    return { input: {}, error: `用户 ${userId} 不存在，请核对用户 ID。` };
  }
  return {
    input: {
      ...(signals.budget !== null ? { subtotal: signals.budget } : {}),
      ...(userId ? { userId } : {}),
      onlyApplicable: false,
    },
    error: null,
  };
}

async function ordersInput(signals: InputSignals): Promise<DerivedToolInput> {
  const userId = signals.input.match(/\buser-\d+\b/i)?.[0] ?? null;
  if (!signals.orderNo && !userId) {
    return {
      input: {},
      error: '订单查询缺少订单号或用户 ID，请补充后重试。',
    };
  }
  return {
    input: {
      ...(signals.orderNo ? { orderNo: signals.orderNo } : {}),
      ...(userId ? { userId } : {}),
    },
    error: null,
  };
}

async function logisticsInput(signals: InputSignals): Promise<DerivedToolInput> {
  if (!signals.orderNo && !signals.trackingNo) {
    return {
      input: {},
      error: '物流查询缺少订单号或运单号，请补充后重试。',
    };
  }
  return {
    input: {
      ...(signals.orderNo ? { orderNo: signals.orderNo } : {}),
      ...(signals.trackingNo ? { trackingNo: signals.trackingNo } : {}),
    },
    error: null,
  };
}

function findActivity(activities: Activity[], signals: InputSignals): Activity | null {
  if (signals.activityId) {
    return activities.find((activity) => activity.id === signals.activityId) ?? null;
  }
  const thresholdMatch = signals.input.match(/满\s*(\d+(?:\.\d+)?)\s*减\s*(\d+(?:\.\d+)?)/);
  if (thresholdMatch) {
    const threshold = Number(thresholdMatch[1]);
    const discount = Number(thresholdMatch[2]);
    const matched = activities.find(
      (activity) =>
        activity.status === '进行中' &&
        activity.type === '满减' &&
        activity.threshold === threshold &&
        activity.discount === discount,
    );
    if (matched) return matched;
  }
  if (/满减|活动/.test(signals.input)) {
    const active = activities.filter((activity) => activity.status === '进行中');
    return (
      active.sort((left, right) => right.discount - left.discount)[0] ?? null
    );
  }
  return null;
}

async function priceInput(
  signals: InputSignals,
  toolResults: ToolResultSnapshot[],
): Promise<DerivedToolInput> {
  const [products, activities] = await Promise.all([
    readCollection('products'),
    readCollection('activities'),
  ]);
  const productList = productOutput(toolResults).items ?? [];
  const preferred =
    productList.find((product) => product.stock > 0) ??
    (signals.productId
      ? products.find((product) => product.id === signals.productId)
      : null) ??
    mentionedProduct(products, signals.input) ??
    products.find((product) => product.stock > 0);

  if (!preferred) {
    return { input: {}, error: '价格试算缺少可售商品，无法生成报价。' };
  }

  const quantity = signals.quantity ?? 1;
  const activity = findActivity(activities, signals);
  const userId = signals.input.match(/\buser-\d+\b/i)?.[0] ?? undefined;
  const code = signals.couponCode ?? undefined;

  // 推荐场景通常一次展示两款商品；只拿第一款试算会让“两款合计”失去 Tool 证据。
  // 在无明确商品/数量时，用候选前两款作为推荐组合计算，保证风险审核的金额有真实依据。
  const bundleItems =
    signals.recommendation &&
    !signals.price &&
    !signals.productId &&
    signals.quantity === null
      ? productList.filter((product) => product.stock > 0).slice(0, 2).map((product) => ({
          productId: product.id,
          quantity: 1,
        }))
      : [];

  return {
    input: {
      items: bundleItems.length > 1 ? bundleItems : [{ productId: preferred.id, quantity }],
      ...(code ? { couponCode: code } : {}),
      ...(activity ? { activityId: activity.id } : {}),
      ...(userId ? { userId } : {}),
    },
    error: null,
  };
}

export async function deriveToolInput(input: {
  toolId: string;
  signals: InputSignals;
  toolResults: ToolResultSnapshot[];
}): Promise<DerivedToolInput> {
  switch (input.toolId) {
    case 'query_products':
      return productsInput(input.signals);
    case 'query_activities':
      return activitiesInput();
    case 'query_coupons':
      return couponsInput(input.signals);
    case 'query_orders':
      return ordersInput(input.signals);
    case 'query_logistics':
      return logisticsInput(input.signals);
    case 'calculate_price':
      return priceInput(input.signals, input.toolResults);
    default:
      return { input: {}, error: `未知工具：${input.toolId}` };
  }
}

