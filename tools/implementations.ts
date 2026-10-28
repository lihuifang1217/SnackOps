import 'server-only';

import { AppError } from '@/lib/errors';
import { readCollection } from '@/lib/store';
import type { Activity, Coupon, User } from '@/lib/schemas';
import {
  calculatePriceInputSchema,
  queryActivitiesInputSchema,
  queryCouponsInputSchema,
  queryLogisticsInputSchema,
  queryOrdersInputSchema,
  queryProductsInputSchema,
  type ToolId,
} from './definitions';

const toCents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;

function includesText(haystack: string, needle: string): boolean {
  return haystack.toLocaleLowerCase('zh-CN').includes(needle.toLocaleLowerCase('zh-CN'));
}

function isWithin(now: Date, startAt: string, endAt: string): boolean {
  const current = now.getTime();
  return current >= new Date(startAt).getTime() && current <= new Date(endAt).getTime();
}

function inactiveReason(coupon: Coupon, now: Date, user: User | null): string | null {
  if (coupon.status !== '启用') return '优惠券已停用';
  if (new Date(coupon.validUntil).getTime() < now.getTime()) return '优惠券已过期';
  if (coupon.newCustomerOnly && !user?.isNewCustomer) return '仅限新客使用';
  return null;
}

function activityEligibleSubtotal(activity: Activity, lines: { productId: string; totalCents: number }[]): number {
  if (activity.applicableProductIds.length === 0) {
    return lines.reduce((sum, line) => sum + line.totalCents, 0);
  }
  return lines
    .filter((line) => activity.applicableProductIds.includes(line.productId))
    .reduce((sum, line) => sum + line.totalCents, 0);
}

function couponEligibleSubtotal(coupon: Coupon, lines: { productId: string; totalCents: number }[]): number {
  if (coupon.applicableProductIds.length === 0) {
    return lines.reduce((sum, line) => sum + line.totalCents, 0);
  }
  return lines
    .filter((line) => coupon.applicableProductIds.includes(line.productId))
    .reduce((sum, line) => sum + line.totalCents, 0);
}

export const toolHandlers: Record<ToolId, (input: unknown) => Promise<unknown>> = {
  query_products: async (raw) => {
    const input = queryProductsInputSchema.parse(raw);
    const products = await readCollection('products');
    const excluded = (input.excludeAllergens ?? []).map((item) => item.toLocaleLowerCase('zh-CN'));

    const filtered = products.filter((product) => {
      if (input.category && !includesText(product.category, input.category)) return false;
      if (input.flavor && !includesText(product.flavor, input.flavor)) return false;
      if (input.maxPrice !== undefined && product.price > input.maxPrice) return false;
      if (input.onlyInStock && (product.stock <= 0 || product.status === '下架')) return false;
      if (input.keyword) {
        const haystack = [
          product.name,
          product.description,
          product.category,
          product.flavor,
          ...product.tags,
          ...product.ingredients,
          ...product.allergens,
          ...product.mayContain,
        ].join(' ');
        if (!includesText(haystack, input.keyword)) return false;
      }
      if (excluded.length > 0) {
        const productAllergens = [...product.allergens, ...product.mayContain].map((item) =>
          item.toLocaleLowerCase('zh-CN'),
        );
        if (excluded.some((item) => productAllergens.some((allergen) => allergen.includes(item)))) {
          return false;
        }
      }
      return true;
    });

    const limit = input.limit ?? 20;
    return { items: filtered.slice(0, limit), total: filtered.length };
  },

  query_activities: async (raw) => {
    const input = queryActivitiesInputSchema.parse(raw);
    const activities = await readCollection('activities');
    const now = new Date();
    const filtered = activities.filter((activity) => {
      if (input.status && activity.status !== input.status) return false;
      if (input.activeOnly && (activity.status !== '进行中' || !isWithin(now, activity.startAt, activity.endAt))) {
        return false;
      }
      if (input.minThreshold !== undefined && activity.threshold < input.minThreshold) return false;
      return true;
    });
    const limit = input.limit ?? 20;
    return { items: filtered.slice(0, limit), total: filtered.length };
  },

  query_coupons: async (raw) => {
    const input = queryCouponsInputSchema.parse(raw);
    const [coupons, users] = await Promise.all([
      readCollection('coupons'),
      readCollection('users'),
    ]);
    const now = new Date();
    const user = input.userId ? (users.find((item) => item.id === input.userId) ?? null) : null;

    const items = coupons
      .filter((coupon) => {
        if (input.status && coupon.status !== input.status) return false;
        if (input.type && coupon.type !== input.type) return false;
        if (input.code && coupon.code !== input.code) return false;
        return true;
      })
      .map((coupon) => {
        let reason = inactiveReason(coupon, now, user);
        if (!reason && input.subtotal !== undefined && input.subtotal < coupon.threshold) {
          reason = `未达到满 ${coupon.threshold} 元使用门槛`;
        }
        if (!reason && coupon.newCustomerOnly && !input.userId) {
          reason = '需要提供用户信息以核验新客资格';
        }
        return {
          ...coupon,
          applicable: reason === null,
          reason: reason ?? '当前可用',
        };
      });

    const filtered = input.onlyApplicable ? items.filter((item) => item.applicable) : items;
    return { items: filtered, total: filtered.length };
  },

  calculate_price: async (raw) => {
    const input = calculatePriceInputSchema.parse(raw);
    const [products, activities, coupons, users] = await Promise.all([
      readCollection('products'),
      readCollection('activities'),
      readCollection('coupons'),
      readCollection('users'),
    ]);

    const productMap = new Map(products.map((product) => [product.id, product]));
    const lines = input.items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new AppError(422, 'PRODUCT_NOT_FOUND', `商品不存在：${item.productId}`);
      }
      if (product.status === '下架') {
        throw new AppError(422, 'PRODUCT_UNAVAILABLE', `商品已下架：${product.name}`);
      }
      if (product.stock < item.quantity) {
        throw new AppError(
          422,
          'INSUFFICIENT_STOCK',
          `${product.name} 库存不足，当前库存 ${product.stock}`,
        );
      }
      const lineTotalCents = toCents(product.price) * item.quantity;
      return {
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        unitPrice: product.price,
        lineTotal: fromCents(lineTotalCents),
        totalCents: lineTotalCents,
      };
    });

    const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
    const notes: string[] = [];
    const now = new Date();

    let activity: Activity | null = null;
    let activityDiscountCents = 0;
    if (input.activityId) {
      const found = activities.find((item) => item.id === input.activityId) ?? null;
      if (!found) {
        throw new AppError(422, 'ACTIVITY_NOT_FOUND', '活动不存在');
      }
      if (found.status !== '进行中' || !isWithin(now, found.startAt, found.endAt)) {
        throw new AppError(422, 'ACTIVITY_NOT_ACTIVE', '活动未开始、已结束或不在进行中');
      }
      const eligibleSubtotal = activityEligibleSubtotal(found, lines);
      if (eligibleSubtotal < toCents(found.threshold)) {
        throw new AppError(
          422,
          'ACTIVITY_THRESHOLD_NOT_MET',
          `活动要求满 ${found.threshold} 元，当前适用商品金额为 ${fromCents(eligibleSubtotal)} 元`,
        );
      }
      activityDiscountCents =
        found.type === '满减'
          ? toCents(found.discount)
          : found.type === '折扣'
            ? Math.round(eligibleSubtotal * (found.discount / 100))
            : 0;
      activity = found;
      notes.push(`已应用活动：${found.name}`);
    }

    let coupon: Coupon | null = null;
    let couponDiscountCents = 0;
    if (input.couponCode) {
      const found =
        coupons.find(
          (item) => item.code.toLocaleLowerCase('en-US') === input.couponCode?.toLocaleLowerCase('en-US'),
        ) ?? null;
      if (!found) {
        throw new AppError(422, 'COUPON_NOT_FOUND', '优惠券不存在');
      }
      const user = input.userId ? (users.find((item) => item.id === input.userId) ?? null) : null;
      const reason = inactiveReason(found, now, user);
      if (reason) {
        throw new AppError(422, 'COUPON_NOT_APPLICABLE', reason);
      }
      if (found.newCustomerOnly && !user) {
        throw new AppError(422, 'CUSTOMER_REQUIRED', '该优惠券需要提供用户信息核验新客资格');
      }
      const eligibleSubtotal = couponEligibleSubtotal(found, lines);
      if (eligibleSubtotal < toCents(found.threshold)) {
        throw new AppError(
          422,
          'COUPON_THRESHOLD_NOT_MET',
          `优惠券要求满 ${found.threshold} 元，当前适用商品金额为 ${fromCents(eligibleSubtotal)} 元`,
        );
      }
      if (activity && (!activity.stackableWithCoupon || !found.stackableWithActivity)) {
        throw new AppError(422, 'PROMOTION_NOT_STACKABLE', '所选活动与优惠券不可叠加');
      }
      couponDiscountCents =
        found.type === '满减'
          ? toCents(found.discount)
          : Math.round(eligibleSubtotal * (found.discount / 100));
      coupon = found;
      notes.push(`已应用优惠券：${found.code}`);
    }

    if (activity && coupon) {
      notes.push('活动与优惠券已按规则叠加');
    }
    if (coupon?.newCustomerOnly) {
      notes.push('新客券仅限首单用户使用');
    }

    const totalCents = Math.max(0, subtotalCents - activityDiscountCents - couponDiscountCents);
    return {
      currency: 'CNY' as const,
      lines: lines.map((line) => ({
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      })),
      subtotal: fromCents(subtotalCents),
      activityDiscount: fromCents(activityDiscountCents),
      couponDiscount: fromCents(couponDiscountCents),
      total: fromCents(totalCents),
      appliedActivity: activity
        ? {
            id: activity.id,
            name: activity.name,
            discount: fromCents(activityDiscountCents),
            description: activity.offerRule,
          }
        : null,
      appliedCoupon: coupon
        ? {
            id: coupon.id,
            name: coupon.name,
            code: coupon.code,
            discount: fromCents(couponDiscountCents),
            description: coupon.description,
          }
        : null,
      notes,
    };
  },

  query_orders: async (raw) => {
    const input = queryOrdersInputSchema.parse(raw);
    if (!input.orderNo && !input.orderId && !input.userId) {
      throw new AppError(400, 'ORDER_FILTER_REQUIRED', '请提供订单号、订单 ID 或用户 ID');
    }
    const [orders, users] = await Promise.all([
      readCollection('orders'),
      readCollection('users'),
    ]);
    const filtered = orders
      .filter((order) => {
        if (input.orderId && order.id !== input.orderId) return false;
        if (input.orderNo && order.orderNo.toLocaleLowerCase('en-US') !== input.orderNo.toLocaleLowerCase('en-US')) {
          return false;
        }
        if (input.userId && order.userId !== input.userId) return false;
        if (input.status && order.status !== input.status) return false;
        if (input.afterSalesStatus && order.afterSalesStatus !== input.afterSalesStatus) return false;
        return true;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    if (filtered.length === 0 && (input.orderNo || input.orderId)) {
      throw new AppError(
        422,
        'ORDER_NOT_FOUND',
        `没有找到订单 ${input.orderNo ?? input.orderId}，请核对订单号后再试。`,
      );
    }

    return {
      items: filtered.map((order) => ({
        ...order,
        userName: users.find((user) => user.id === order.userId)?.name ?? '未知用户',
      })),
      total: filtered.length,
    };
  },

  query_logistics: async (raw) => {
    const input = queryLogisticsInputSchema.parse(raw);
    if (!input.orderNo && !input.orderId && !input.trackingNo) {
      throw new AppError(400, 'LOGISTICS_FILTER_REQUIRED', '请提供订单号、订单 ID 或物流单号');
    }
    const [orders, users] = await Promise.all([
      readCollection('orders'),
      readCollection('users'),
    ]);
    const filtered = orders
      .filter((order) => {
        const logisticsStatus = order.logistics?.status ?? order.logisticsStatus;
        if (input.orderId && order.id !== input.orderId) return false;
        if (input.orderNo && order.orderNo.toLocaleLowerCase('en-US') !== input.orderNo.toLocaleLowerCase('en-US')) {
          return false;
        }
        if (
          input.trackingNo &&
          order.logistics?.trackingNo.toLocaleLowerCase('en-US') !== input.trackingNo.toLocaleLowerCase('en-US')
        ) {
          return false;
        }
        if (input.status && logisticsStatus !== input.status) return false;
        return true;
      })
      .sort((left, right) => {
        const leftTime = left.logistics?.updatedAt ?? left.createdAt;
        const rightTime = right.logistics?.updatedAt ?? right.createdAt;
        return rightTime.localeCompare(leftTime);
      });

    if (filtered.length === 0) {
      throw new AppError(
        422,
        'LOGISTICS_NOT_FOUND',
        `没有找到对应的物流记录 ${input.trackingNo ?? input.orderNo ?? input.orderId}，请核对后重试。`,
      );
    }

    return {
      items: filtered.map((order) => ({
        orderId: order.id,
        orderNo: order.orderNo,
        orderStatus: order.status,
        userName: users.find((user) => user.id === order.userId)?.name ?? '未知用户',
        carrier: order.logistics?.carrier ?? null,
        trackingNo: order.logistics?.trackingNo ?? null,
        status: order.logistics?.status ?? order.logisticsStatus,
        latestEvent: order.logistics?.latestEvent ?? (order.logisticsStatus === '未发货' ? '订单尚未发货' : order.logisticsStatus),
        events: order.logistics?.events ?? [],
        updatedAt: order.logistics?.updatedAt ?? order.createdAt,
      })),
      total: filtered.length,
    };
  },
};
