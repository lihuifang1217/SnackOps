import { z } from 'zod';
import {
  activitySchema,
  couponSchema,
  orderSchema,
  productSchema,
} from '@/lib/schemas';

export const queryProductsInputSchema = z
  .object({
    keyword: z.string().trim().max(80).optional(),
    category: z.string().trim().max(40).optional(),
    flavor: z.string().trim().max(40).optional(),
    maxPrice: z.number().positive().max(100000).optional(),
    excludeAllergens: z.array(z.string().trim().min(1)).max(20).optional(),
    onlyInStock: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const queryProductsOutputSchema = z.object({
  items: z.array(productSchema),
  total: z.number().int().nonnegative(),
});

export const queryActivitiesInputSchema = z
  .object({
    status: z.enum(['进行中', '已结束', '草稿']).optional(),
    activeOnly: z.boolean().optional(),
    minThreshold: z.number().nonnegative().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const queryActivitiesOutputSchema = z.object({
  items: z.array(activitySchema),
  total: z.number().int().nonnegative(),
});

export const couponResultSchema = couponSchema.extend({
  applicable: z.boolean(),
  reason: z.string(),
});

export const queryCouponsInputSchema = z
  .object({
    status: z.enum(['启用', '停用']).optional(),
    type: z.enum(['满减', '折扣']).optional(),
    code: z.string().trim().max(40).optional(),
    subtotal: z.number().nonnegative().optional(),
    userId: z.string().trim().max(80).optional(),
    onlyApplicable: z.boolean().optional(),
  })
  .strict();

export const queryCouponsOutputSchema = z.object({
  items: z.array(couponResultSchema),
  total: z.number().int().nonnegative(),
});

export const calculatePriceInputSchema = z
  .object({
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          quantity: z.number().int().min(1).max(99),
        }),
      )
      .min(1)
      .max(20),
    couponCode: z.string().trim().max(40).optional(),
    activityId: z.string().trim().max(80).optional(),
    userId: z.string().trim().max(80).optional(),
  })
  .strict();

export const priceLineSchema = z.object({
  productId: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  lineTotal: z.number().nonnegative(),
});

export const appliedPromotionSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().optional(),
  discount: z.number().nonnegative(),
  description: z.string(),
});

export const calculatePriceOutputSchema = z.object({
  currency: z.literal('CNY'),
  lines: z.array(priceLineSchema),
  subtotal: z.number().nonnegative(),
  activityDiscount: z.number().nonnegative(),
  couponDiscount: z.number().nonnegative(),
  total: z.number().nonnegative(),
  appliedActivity: appliedPromotionSchema.nullable(),
  appliedCoupon: appliedPromotionSchema.nullable(),
  notes: z.array(z.string()),
});

export const queryOrdersInputSchema = z
  .object({
    orderNo: z.string().trim().max(80).optional(),
    orderId: z.string().trim().max(80).optional(),
    userId: z.string().trim().max(80).optional(),
    status: z.enum(['待发货', '已发货', '已签收', '售后中', '已取消']).optional(),
    afterSalesStatus: z.enum(['无', '处理中', '补发中', '退款中', '已完成']).optional(),
  })
  .strict();

export const orderResultSchema = orderSchema.extend({
  userName: z.string(),
});

export const queryOrdersOutputSchema = z.object({
  items: z.array(orderResultSchema),
  total: z.number().int().nonnegative(),
});

export const queryLogisticsInputSchema = z
  .object({
    orderNo: z.string().trim().max(80).optional(),
    orderId: z.string().trim().max(80).optional(),
    trackingNo: z.string().trim().max(80).optional(),
    status: z.enum(['未发货', '已揽收', '运输中', '派送中', '已签收', '异常']).optional(),
  })
  .strict();

export const logisticsResultSchema = z.object({
  orderId: z.string(),
  orderNo: z.string(),
  orderStatus: z.string(),
  userName: z.string(),
  carrier: z.string().nullable(),
  trackingNo: z.string().nullable(),
  status: z.enum(['未发货', '已揽收', '运输中', '派送中', '已签收', '异常']),
  latestEvent: z.string(),
  events: z.array(z.object({ at: z.string(), description: z.string() })),
  updatedAt: z.string(),
});

export const queryLogisticsOutputSchema = z.object({
  items: z.array(logisticsResultSchema),
  total: z.number().int().nonnegative(),
});

export type QueryProductsInput = z.infer<typeof queryProductsInputSchema>;
export type QueryActivitiesInput = z.infer<typeof queryActivitiesInputSchema>;
export type QueryCouponsInput = z.infer<typeof queryCouponsInputSchema>;
export type CalculatePriceInput = z.infer<typeof calculatePriceInputSchema>;
export type QueryOrdersInput = z.infer<typeof queryOrdersInputSchema>;
export type QueryLogisticsInput = z.infer<typeof queryLogisticsInputSchema>;

export type ToolId =
  | 'query_products'
  | 'query_activities'
  | 'query_coupons'
  | 'calculate_price'
  | 'query_orders'
  | 'query_logistics';

export type ToolDefinition = {
  id: ToolId;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  sampleInput: unknown;
  executionMode: string;
  implementationPath: string;
  dataSources: string[];
  outputExample: unknown;
};

export const toolDefinitions = {
  query_products: {
    id: 'query_products',
    executionMode: '本地只读函数',
    implementationPath: 'tools/implementations.ts#query_products',
    dataSources: ["data/products.json"],
    outputExample: {
      items: [
        {
          id: 'prod-01',
          name: '每日混合坚果 25g × 7',
          category: '坚果',
          flavor: '原味烘焙',
          price: 39.9,
          stock: 86,
          status: '在售',
          allergens: ['核桃', '巴旦木', '腰果'],
          mayContain: ['花生', '芝麻'],
        },
      ],
      total: 1,
    },
    inputSchema: queryProductsInputSchema,
    outputSchema: queryProductsOutputSchema,
    sampleInput: { keyword: '坚果', onlyInStock: true, limit: 5 },
  },
  query_activities: {
    id: 'query_activities',
    executionMode: '本地只读函数',
    implementationPath: 'tools/implementations.ts#query_activities',
    dataSources: ["data/activities.json"],
    outputExample: {
      items: [
        {
          id: 'act-01',
          name: '满 99 减 20',
          type: '满减',
          status: '进行中',
          threshold: 99,
          discount: 20,
          offerRule: '满 99 元减 20 元',
        },
      ],
      total: 1,
    },
    inputSchema: queryActivitiesInputSchema,
    outputSchema: queryActivitiesOutputSchema,
    sampleInput: { activeOnly: true, limit: 10 },
  },
  query_coupons: {
    id: 'query_coupons',
    executionMode: '本地只读函数',
    implementationPath: 'tools/implementations.ts#query_coupons',
    dataSources: ["data/coupons.json", "data/users.json"],
    outputExample: {
      items: [
        {
          id: 'coupon-01',
          name: '新客立减 10 元',
          code: 'HELLO10',
          type: '满减',
          threshold: 29,
          discount: 10,
          applicable: true,
          reason: '满足门槛且为新客可用',
        },
      ],
      total: 1,
    },
    inputSchema: queryCouponsInputSchema,
    outputSchema: queryCouponsOutputSchema,
    sampleInput: { subtotal: 119.7, userId: 'user-04', onlyApplicable: true },
  },
  calculate_price: {
    id: 'calculate_price',
    executionMode: '本地只读计算',
    implementationPath: 'tools/implementations.ts#calculate_price',
    dataSources: ["data/products.json", "data/activities.json", "data/coupons.json", "data/users.json"],
    outputExample: {
      currency: 'CNY',
      lines: [
        {
          productId: 'prod-01',
          name: '每日混合坚果 25g × 7',
          quantity: 3,
          unitPrice: 39.9,
          lineTotal: 119.7,
        },
      ],
      subtotal: 119.7,
      activityDiscount: 20,
      couponDiscount: 20,
      total: 79.7,
      appliedActivity: { id: 'act-01', name: '满 99 减 20', discount: 20, description: '满 99 元减 20 元' },
      appliedCoupon: { id: 'coupon-01', name: 'SNACK20', code: 'SNACK20', discount: 20, description: '满 99 减 20' },
      notes: ['价格基于真实商品、活动和优惠券数据试算。'],
    },
    inputSchema: calculatePriceInputSchema,
    outputSchema: calculatePriceOutputSchema,
    sampleInput: {
      items: [{ productId: 'prod-01', quantity: 3 }],
      couponCode: 'SNACK20',
      activityId: 'act-01',
      userId: 'user-01',
    },
  },
  query_orders: {
    id: 'query_orders',
    executionMode: '本地只读函数',
    implementationPath: 'tools/implementations.ts#query_orders',
    dataSources: ["data/orders.json", "data/users.json"],
    outputExample: {
      items: [
        {
          id: 'order-20261017-014',
          orderNo: 'SN202610170014',
          userId: 'user-02',
          userName: '林小满',
          itemSummary: '海盐苏打饼干 300g × 1、香辣锅巴 220g × 2',
          amount: 46.7,
          status: '已发货',
          logisticsStatus: '运输中',
          afterSalesStatus: '无',
          logistics: {
            carrier: '顺丰速运',
            trackingNo: 'SF143820261017',
            status: '运输中',
            latestEvent: '快件已到达上海转运中心',
          },
        },
      ],
      total: 1,
    },
    inputSchema: queryOrdersInputSchema,
    outputSchema: queryOrdersOutputSchema,
    sampleInput: { orderNo: 'SN202610180001' },
  },
  query_logistics: {
    id: 'query_logistics',
    executionMode: '本地只读函数',
    implementationPath: 'tools/implementations.ts#query_logistics',
    dataSources: ["data/orders.json（订单内嵌物流）", "data/users.json"],
    outputExample: {
      items: [
        {
          orderId: 'order-20261017-014',
          orderNo: 'SN202610170014',
          orderStatus: '已发货',
          userName: '林小满',
          carrier: '顺丰速运',
          trackingNo: 'SF143820261017',
          status: '运输中',
          latestEvent: '快件已到达上海转运中心',
          events: [
            { at: '2026-10-18T08:15:00+08:00', description: '快件已到达上海转运中心' },
          ],
          updatedAt: '2026-10-18T08:15:00+08:00',
        },
      ],
      total: 1,
    },
    inputSchema: queryLogisticsInputSchema,
    outputSchema: queryLogisticsOutputSchema,
    sampleInput: { orderNo: 'SN202610170014' },
  },
} as const satisfies Record<ToolId, ToolDefinition>;

export function isToolId(value: string): value is ToolId {
  return Object.prototype.hasOwnProperty.call(toolDefinitions, value);
}
