import 'server-only';

import type { z } from 'zod';
import { AppError } from '@/lib/errors';
import {
  activitySchema,
  couponSchema,
  faqSchema,
  handoffRuleSchema,
  productSchema,
  returnPolicySchema,
  type Activity,
  type Coupon,
  type Faq,
  type HandoffRule,
  type Product,
  type ReturnPolicy,
} from '@/lib/schemas';
import { readCollection, writeCollection } from '@/lib/store';
import {
  assertEditableCatalogType,
  type EditableCatalogType,
} from './catalog';
import { withRegistryLock } from './registry/lock';

export type EditableCatalogRecord = Record<string, unknown>;

type EditableConfig = {
  schema: z.ZodType<EditableCatalogRecord>;
  read: () => Promise<EditableCatalogRecord[]>;
  write: (records: EditableCatalogRecord[]) => Promise<unknown>;
};

const editableConfigs: Record<EditableCatalogType, EditableConfig> = {
  products: {
    schema: productSchema as unknown as z.ZodType<EditableCatalogRecord>,
    read: async () =>
      (await readCollection('products')) as unknown as EditableCatalogRecord[],
    write: async (records) => {
      await writeCollection('products', records as unknown as Product[]);
    },
  },
  activities: {
    schema: activitySchema as unknown as z.ZodType<EditableCatalogRecord>,
    read: async () =>
      (await readCollection('activities')) as unknown as EditableCatalogRecord[],
    write: async (records) => {
      await writeCollection('activities', records as unknown as Activity[]);
    },
  },
  coupons: {
    schema: couponSchema as unknown as z.ZodType<EditableCatalogRecord>,
    read: async () =>
      (await readCollection('coupons')) as unknown as EditableCatalogRecord[],
    write: async (records) => {
      await writeCollection('coupons', records as unknown as Coupon[]);
    },
  },
  'return-policies': {
    schema: returnPolicySchema as unknown as z.ZodType<EditableCatalogRecord>,
    read: async () =>
      (await readCollection('return-policies')) as unknown as EditableCatalogRecord[],
    write: async (records) => {
      await writeCollection('return-policies', records as unknown as ReturnPolicy[]);
    },
  },
  faq: {
    schema: faqSchema as unknown as z.ZodType<EditableCatalogRecord>,
    read: async () =>
      (await readCollection('faq')) as unknown as EditableCatalogRecord[],
    write: async (records) => {
      await writeCollection('faq', records as unknown as Faq[]);
    },
  },
  'handoff-rules': {
    schema: handoffRuleSchema as unknown as z.ZodType<EditableCatalogRecord>,
    read: async () =>
      (await readCollection('handoff-rules')) as unknown as EditableCatalogRecord[],
    write: async (records) => {
      await writeCollection('handoff-rules', records as unknown as HandoffRule[]);
    },
  },
};

const RECORD_ID_PATTERN = /^[\p{L}\p{N}_-]{1,80}$/u;
const TYPES_WITH_UPDATED_AT = new Set<EditableCatalogType>([
  'return-policies',
  'faq',
  'handoff-rules',
]);

function validateRecordId(value: unknown): string {
  if (typeof value !== 'string' || !RECORD_ID_PATTERN.test(value) || value.includes('..')) {
    throw new AppError(
      400,
      'INVALID_CATALOG_ID',
      'ID 只能包含中英文字母、数字、下划线和连字符，不能包含路径分隔符或 ..',
    );
  }
  return value;
}

function asObject(value: unknown): EditableCatalogRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'INVALID_CATALOG_RECORD', '请求体必须是业务数据对象');
  }
  return value as EditableCatalogRecord;
}

function parseRecord(
  type: EditableCatalogType,
  raw: unknown,
): EditableCatalogRecord {
  const object = asObject(raw);
  validateRecordId(object.id);
  const prepared = TYPES_WITH_UPDATED_AT.has(type)
    ? { ...object, updatedAt: new Date().toISOString() }
    : object;
  return editableConfigs[type].schema.parse(prepared);
}

export async function createCatalogRecord(
  type: string,
  raw: unknown,
): Promise<EditableCatalogRecord> {
  const catalogType = assertEditableCatalogType(type);
  const record = parseRecord(catalogType, raw);
  const config = editableConfigs[catalogType];

  return withRegistryLock(`catalog-${catalogType}`, async () => {
    const records = await config.read();
    if (records.some((item) => item.id === record.id)) {
      throw new AppError(409, 'CATALOG_ID_EXISTS', `记录 ID ${record.id} 已存在`);
    }
    await config.write([...records, record]);
    return record;
  });
}

export async function updateCatalogRecord(
  type: string,
  id: string,
  raw: unknown,
): Promise<EditableCatalogRecord> {
  const catalogType = assertEditableCatalogType(type);
  const recordId = validateRecordId(id);
  const record = parseRecord(catalogType, raw);
  if (record.id !== recordId) {
    throw new AppError(400, 'CATALOG_ID_MISMATCH', '请求体 ID 与 URL 中的记录 ID 不一致');
  }
  const config = editableConfigs[catalogType];

  return withRegistryLock(`catalog-${catalogType}`, async () => {
    const records = await config.read();
    if (!records.some((item) => item.id === recordId)) {
      throw new AppError(404, 'CATALOG_RECORD_NOT_FOUND', '业务记录不存在');
    }
    await config.write(records.map((item) => (item.id === recordId ? record : item)));
    return record;
  });
}

export async function deleteCatalogRecord(
  type: string,
  id: string,
): Promise<EditableCatalogRecord> {
  const catalogType = assertEditableCatalogType(type);
  const recordId = validateRecordId(id);
  const config = editableConfigs[catalogType];

  return withRegistryLock(`catalog-${catalogType}`, async () => {
    const records = await config.read();
    const found = records.find((item) => item.id === recordId);
    if (!found) {
      throw new AppError(404, 'CATALOG_RECORD_NOT_FOUND', '业务记录不存在');
    }
    await config.write(records.filter((item) => item.id !== recordId));
    return found;
  });
}
