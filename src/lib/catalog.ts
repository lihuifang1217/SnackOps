import 'server-only';

import { AppError } from '@/lib/errors';
import { readCollection } from '@/lib/store';
import type {
  CatalogOverviewResponse,
  CatalogRecordSummary,
  CatalogRecordsResponse,
} from '@/lib/types';

export const catalogTypes = [
  {
    type: 'products',
    label: '商品',
    description: '商品、口味、价格、库存、配料与营养信息',
    editable: true,
  },
  {
    type: 'activities',
    label: '活动',
    description: '活动门槛、优惠规则与有效期',
    editable: true,
  },
  {
    type: 'coupons',
    label: '优惠券',
    description: '优惠类型、金额、门槛、适用商品与资格',
    editable: true,
  },
  {
    type: 'orders',
    label: '订单',
    description: '订单商品、金额、内嵌物流与售后状态',
    editable: false,
  },
  {
    type: 'users',
    label: '用户',
    description: '新客状态、历史订单与口味过敏偏好',
    editable: false,
  },
  {
    type: 'return-policies',
    label: '售后政策',
    description: '破损、缺件、退换货与退款规则',
    editable: true,
  },
  {
    type: 'faq',
    label: 'FAQ',
    description: '客服常见问题与标准答复',
    editable: true,
  },
  {
    type: 'tickets',
    label: '工单',
    description: '客服工单、优先级与处理状态',
    editable: false,
  },
  {
    type: 'handoff-rules',
    label: '转人工规则',
    description: '过敏、投诉、诈骗与工具异常接管条件',
    editable: true,
  },
] as const;

export type CatalogType = (typeof catalogTypes)[number]['type'];
export type EditableCatalogType =
  | 'products'
  | 'activities'
  | 'coupons'
  | 'return-policies'
  | 'faq'
  | 'handoff-rules';

const catalogTypeSet = new Set<string>(catalogTypes.map((item) => item.type));
const editableTypeSet = new Set<string>(
  catalogTypes.filter((item) => item.editable).map((item) => item.type),
);

export function assertCatalogType(value: string): CatalogType {
  if (!catalogTypeSet.has(value)) {
    throw new AppError(404, 'CATALOG_TYPE_NOT_FOUND', '业务数据类型不存在');
  }
  return value as CatalogType;
}

export function assertEditableCatalogType(value: string): EditableCatalogType {
  const type = assertCatalogType(value);
  if (!editableTypeSet.has(type)) {
    throw new AppError(
      403,
      'CATALOG_TYPE_READ_ONLY',
      `${type} 是系统业务记录，不允许在业务目录中新增、编辑或删除。`,
    );
  }
  return type as EditableCatalogType;
}

function money(value: number): string {
  return `¥${value.toFixed(2)}`;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function limitedTags(tags: string[], max = 4): string[] {
  return [...new Set(tags)].slice(0, max);
}

function rawData(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

export async function getCatalogOverview(): Promise<CatalogOverviewResponse> {
  const types = await Promise.all(
    catalogTypes.map(async (definition) => {
      const count = (await readCollection(definition.type)).length;
      return { ...definition, count };
    }),
  );
  return { types, generatedAt: new Date().toISOString() };
}

async function productRecords(): Promise<CatalogRecordSummary[]> {
  const products = await readCollection('products');
  return products.map((product) => ({
    id: product.id,
    title: product.name,
    subtitle: product.description,
    status: product.status,
    meta: [
      { label: '价格', value: money(product.price) },
      { label: '库存', value: String(product.stock) },
      { label: '分类', value: product.category },
      { label: '糖分', value: `${product.nutrition.sugarG}g / 100g` },
      { label: '明确过敏原', value: product.allergens.join('、') || '无' },
      { label: '可能含有', value: product.mayContain.join('、') || '无' },
    ],
    tags: limitedTags([product.flavor, ...product.tags]),
    data: rawData(product),
  }));
}

async function activityRecords(): Promise<CatalogRecordSummary[]> {
  const activities = await readCollection('activities');
  return activities.map((activity) => ({
    id: activity.id,
    title: activity.name,
    subtitle: activity.description,
    status: activity.status,
    meta: [
      { label: '门槛', value: `满 ¥${activity.threshold}` },
      { label: '规则', value: activity.offerRule },
      { label: '有效期', value: `${dateOnly(activity.startAt)} 至 ${dateOnly(activity.endAt)}` },
    ],
    tags: limitedTags([activity.type, activity.stackableWithCoupon ? '可叠加优惠券' : '不可叠加']),
    data: rawData(activity),
  }));
}

async function couponRecords(): Promise<CatalogRecordSummary[]> {
  const coupons = await readCollection('coupons');
  return coupons.map((coupon) => ({
    id: coupon.id,
    title: `${coupon.name} · ${coupon.code}`,
    subtitle: coupon.description,
    status: coupon.status,
    meta: [
      { label: '门槛', value: `满 ¥${coupon.threshold}` },
      { label: '优惠', value: coupon.type === '折扣' ? `${coupon.discount}% off` : `减 ¥${coupon.discount}` },
      { label: '有效期至', value: dateOnly(coupon.validUntil) },
    ],
    tags: limitedTags([
      coupon.type,
      coupon.newCustomerOnly ? '新客专享' : '通用',
      coupon.stackableWithActivity ? '可叠加活动' : '不可叠加',
    ]),
    data: rawData(coupon),
  }));
}

async function orderRecords(): Promise<CatalogRecordSummary[]> {
  const [orders, users] = await Promise.all([
    readCollection('orders'),
    readCollection('users'),
  ]);
  const userMap = new Map(users.map((user) => [user.id, user]));
  return orders.map((order) => ({
    id: order.id,
    title: order.orderNo,
    subtitle: order.itemSummary,
    status: order.status,
    meta: [
      { label: '用户', value: userMap.get(order.userId)?.name ?? order.userId },
      { label: '金额', value: money(order.amount) },
      {
        label: '物流',
        value: order.logistics
          ? `${order.logistics.carrier} · ${order.logistics.status}`
          : order.logisticsStatus,
      },
      { label: '售后', value: order.afterSalesStatus },
    ],
    tags: limitedTags([order.status, order.logisticsStatus, order.afterSalesStatus]),
    data: rawData(order),
  }));
}

async function userRecords(): Promise<CatalogRecordSummary[]> {
  const users = await readCollection('users');
  return users.map((user) => ({
    id: user.id,
    title: user.name,
    subtitle: `${user.phoneMasked} · 加入于 ${dateOnly(user.joinedAt)}`,
    status: user.isNewCustomer ? '新客资格' : user.segment,
    meta: [
      { label: '订单数', value: String(user.orderCount) },
      { label: '口味偏好', value: user.preferences.flavors.join('、') || '未填写' },
      { label: '避开过敏原', value: user.preferences.avoidAllergens.join('、') || '无' },
    ],
    tags: limitedTags([user.segment, ...user.preferences.flavors]),
    data: rawData(user),
  }));
}

async function policyRecords(): Promise<CatalogRecordSummary[]> {
  const policies = await readCollection('return-policies');
  return policies.map((policy) => ({
    id: policy.id,
    title: policy.name,
    subtitle: policy.scope,
    status: policy.type,
    meta: [
      { label: '处理窗口', value: `${policy.windowHours} 小时` },
      { label: '处理方式', value: policy.resolution },
    ],
    tags: limitedTags(policy.conditions),
    data: rawData(policy),
  }));
}

async function faqRecords(): Promise<CatalogRecordSummary[]> {
  const faq = await readCollection('faq');
  return faq.map((item) => ({
    id: item.id,
    title: item.question,
    subtitle: item.answer,
    status: item.category,
    meta: [{ label: '更新时间', value: dateOnly(item.updatedAt) }],
    tags: limitedTags(item.tags),
    data: rawData(item),
  }));
}

async function ticketRecords(): Promise<CatalogRecordSummary[]> {
  const tickets = await readCollection('tickets');
  return tickets.map((ticket) => ({
    id: ticket.id,
    title: ticket.subject,
    subtitle: `${ticket.customer} · ${ticket.channel} · ${ticket.assignee}`,
    status: ticket.status,
    meta: [
      { label: '优先级', value: ticket.priority },
      { label: '关联技能', value: ticket.skill },
      { label: '更新时间', value: ticket.updatedAt.slice(0, 16).replace('T', ' ') },
    ],
    tags: limitedTags([ticket.priority, ticket.channel, ticket.skill]),
    data: rawData(ticket),
  }));
}

async function handoffRecords(): Promise<CatalogRecordSummary[]> {
  const rules = await readCollection('handoff-rules');
  return rules.map((rule) => ({
    id: rule.id,
    title: rule.name,
    subtitle: rule.trigger,
    status: rule.enabled ? '启用' : '停用',
    meta: [
      { label: '动作', value: rule.action },
      { label: '优先级', value: rule.priority },
      { label: '更新时间', value: dateOnly(rule.updatedAt) },
    ],
    tags: limitedTags(rule.conditions),
    data: rawData(rule),
  }));
}

export async function getCatalogRecords(type: string): Promise<CatalogRecordsResponse> {
  const catalogType = assertCatalogType(type);
  const definition = catalogTypes.find((item) => item.type === catalogType);
  if (!definition) {
    throw new AppError(404, 'CATALOG_TYPE_NOT_FOUND', '业务数据类型不存在');
  }

  const records = await (async (): Promise<CatalogRecordSummary[]> => {
    switch (catalogType) {
      case 'products':
        return productRecords();
      case 'activities':
        return activityRecords();
      case 'coupons':
        return couponRecords();
      case 'orders':
        return orderRecords();
      case 'users':
        return userRecords();
      case 'return-policies':
        return policyRecords();
      case 'faq':
        return faqRecords();
      case 'tickets':
        return ticketRecords();
      case 'handoff-rules':
        return handoffRecords();
    }
  })();

  return {
    type: catalogType,
    label: definition.label,
    description: definition.description,
    total: records.length,
    records,
  };
}
