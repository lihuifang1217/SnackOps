'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Database,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Tags,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest, jsonBody } from '@/lib/client';
import type {
  CatalogMutationResponse,
  CatalogOverviewResponse,
  CatalogRecordsResponse,
  CatalogRecordSummary,
  CatalogTypeInfo,
} from '@/lib/types';

type EditableType =
  | 'products'
  | 'activities'
  | 'coupons'
  | 'return-policies'
  | 'faq'
  | 'handoff-rules';

type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'list';

type FieldDef = {
  path: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  help?: string;
  span?: 1 | 2;
};

type FormConfig = {
  newLabel: string;
  defaults: () => Record<string, unknown>;
  fields: FieldDef[];
};

type EditorState = {
  mode: 'create' | 'edit';
  type: EditableType;
  record: Record<string, unknown>;
};

function suffix(): string {
  return Date.now().toString(36).slice(-7);
}

function nowIso(): string {
  return new Date().toISOString();
}

function baseProduct(): Record<string, unknown> {
  return {
    id: `prod-${suffix()}`,
    name: '',
    description: '',
    category: '',
    flavor: '',
    price: 0,
    stock: 0,
    status: '在售',
    tags: [],
    ingredients: [],
    allergens: [],
    mayContain: [],
    nutrition: {
      basis: '每100g',
      energyKcal: 0,
      proteinG: 0,
      fatG: 0,
      carbohydrateG: 0,
      sugarG: 0,
      sodiumMg: 0,
    },
    shelfLifeDays: 180,
  };
}

const formConfigs: Record<EditableType, FormConfig> = {
  products: {
    newLabel: '新增商品',
    defaults: baseProduct,
    fields: [
      { path: 'id', label: '商品 ID', type: 'text' },
      { path: 'name', label: '商品名称', type: 'text' },
      { path: 'category', label: '分类', type: 'text' },
      { path: 'flavor', label: '口味', type: 'text' },
      { path: 'price', label: '价格（元）', type: 'number' },
      { path: 'stock', label: '库存', type: 'number' },
      { path: 'status', label: '状态', type: 'select', options: ['在售', '预售', '下架'] },
      { path: 'shelfLifeDays', label: '保质期（天）', type: 'number' },
      { path: 'description', label: '描述', type: 'textarea', span: 2 },
      { path: 'tags', label: '标签', type: 'list', help: '每行一个标签' },
      { path: 'ingredients', label: '配料', type: 'list', help: '每行一个配料' },
      { path: 'allergens', label: '明确过敏原', type: 'list', help: '每行一个过敏原' },
      { path: 'mayContain', label: '可能含有', type: 'list', help: '每行一个过敏原' },
      { path: 'nutrition.energyKcal', label: '能量 kcal / 100g', type: 'number' },
      { path: 'nutrition.proteinG', label: '蛋白质 g / 100g', type: 'number' },
      { path: 'nutrition.fatG', label: '脂肪 g / 100g', type: 'number' },
      { path: 'nutrition.carbohydrateG', label: '碳水 g / 100g', type: 'number' },
      { path: 'nutrition.sugarG', label: '糖 g / 100g', type: 'number' },
      { path: 'nutrition.sodiumMg', label: '钠 mg / 100g', type: 'number' },
    ],
  },
  activities: {
    newLabel: '新增活动',
    defaults: () => ({
      id: `act-${suffix()}`,
      name: '',
      type: '满减',
      status: '草稿',
      startAt: nowIso(),
      endAt: nowIso(),
      threshold: 0,
      discount: 0,
      offerRule: '',
      applicableProductIds: [],
      stackableWithCoupon: false,
      description: '',
    }),
    fields: [
      { path: 'id', label: '活动 ID', type: 'text' },
      { path: 'name', label: '活动名称', type: 'text' },
      { path: 'type', label: '类型', type: 'select', options: ['满减', '折扣', '赠品'] },
      { path: 'status', label: '状态', type: 'select', options: ['进行中', '已结束', '草稿'] },
      { path: 'startAt', label: '开始时间', type: 'text', help: 'ISO 8601，例如 2026-10-18T10:00:00+08:00' },
      { path: 'endAt', label: '结束时间', type: 'text', help: 'ISO 8601' },
      { path: 'threshold', label: '门槛（元）', type: 'number' },
      { path: 'discount', label: '优惠值', type: 'number' },
      { path: 'offerRule', label: '优惠规则', type: 'text', span: 2 },
      { path: 'applicableProductIds', label: '适用商品 ID', type: 'list', help: '每行一个商品 ID；留空表示全场' },
      { path: 'stackableWithCoupon', label: '可叠加优惠券', type: 'boolean' },
      { path: 'description', label: '描述', type: 'textarea', span: 2 },
    ],
  },
  coupons: {
    newLabel: '新增优惠券',
    defaults: () => ({
      id: `coupon-${suffix()}`,
      name: '',
      code: '',
      type: '满减',
      threshold: 0,
      discount: 0,
      status: '启用',
      validUntil: nowIso(),
      newCustomerOnly: false,
      applicableProductIds: [],
      stackableWithActivity: false,
      description: '',
    }),
    fields: [
      { path: 'id', label: '优惠券 ID', type: 'text' },
      { path: 'name', label: '名称', type: 'text' },
      { path: 'code', label: '券码', type: 'text' },
      { path: 'type', label: '类型', type: 'select', options: ['满减', '折扣'] },
      { path: 'threshold', label: '门槛（元）', type: 'number' },
      { path: 'discount', label: '优惠值', type: 'number' },
      { path: 'status', label: '状态', type: 'select', options: ['启用', '停用'] },
      { path: 'validUntil', label: '有效期至', type: 'text', help: 'ISO 8601' },
      { path: 'newCustomerOnly', label: '仅限新客', type: 'boolean' },
      { path: 'stackableWithActivity', label: '可叠加活动', type: 'boolean' },
      { path: 'applicableProductIds', label: '适用商品 ID', type: 'list', help: '每行一个商品 ID；留空表示全场' },
      { path: 'description', label: '描述', type: 'textarea', span: 2 },
    ],
  },
  'return-policies': {
    newLabel: '新增售后政策',
    defaults: () => ({
      id: `policy-${suffix()}`,
      name: '',
      type: '退换货',
      scope: '',
      windowHours: 48,
      conditions: [],
      resolution: '',
      updatedAt: nowIso(),
    }),
    fields: [
      { path: 'id', label: '政策 ID', type: 'text' },
      { path: 'name', label: '政策名称', type: 'text' },
      { path: 'type', label: '类型', type: 'select', options: ['破损', '缺件', '退换货', '退款'] },
      { path: 'windowHours', label: '处理窗口（小时）', type: 'number' },
      { path: 'scope', label: '适用范围', type: 'text', span: 2 },
      { path: 'conditions', label: '条件', type: 'list', help: '每行一个条件' },
      { path: 'resolution', label: '处理方式', type: 'textarea', span: 2 },
    ],
  },
  faq: {
    newLabel: '新增 FAQ',
    defaults: () => ({
      id: `faq-${suffix()}`,
      category: '发货',
      question: '',
      answer: '',
      tags: [],
      updatedAt: nowIso(),
    }),
    fields: [
      { path: 'id', label: 'FAQ ID', type: 'text' },
      { path: 'category', label: '分类', type: 'text' },
      { path: 'question', label: '问题', type: 'text', span: 2 },
      { path: 'answer', label: '标准答复', type: 'textarea', span: 2 },
      { path: 'tags', label: '标签', type: 'list', help: '每行一个标签' },
    ],
  },
  'handoff-rules': {
    newLabel: '新增转人工规则',
    defaults: () => ({
      id: `handoff-${suffix()}`,
      name: '',
      trigger: '',
      conditions: [],
      action: '转人工',
      priority: '普通',
      enabled: true,
      updatedAt: nowIso(),
    }),
    fields: [
      { path: 'id', label: '规则 ID', type: 'text' },
      { path: 'name', label: '规则名称', type: 'text' },
      { path: 'trigger', label: '触发描述', type: 'text', span: 2 },
      { path: 'action', label: '动作', type: 'select', options: ['转人工', '优先人工', '安全阻断后转人工'] },
      { path: 'priority', label: '优先级', type: 'select', options: ['普通', '紧急'] },
      { path: 'conditions', label: '条件', type: 'list', span: 2, help: '每行一个条件' },
      { path: 'enabled', label: '启用规则', type: 'boolean' },
    ],
  },
};

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(record);
}

function getField(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, record);
}

function setField(
  record: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const next = cloneRecord(record);
  const keys = path.split('.');
  let cursor: Record<string, unknown> = next;
  for (const key of keys.slice(0, -1)) {
    const child = cursor[key];
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
  return next;
}

function normalizeRecord(record: Record<string, unknown>, config: FormConfig): Record<string, unknown> {
  const next: Record<string, unknown> = { ...record };
  for (const field of config.fields) {
    const value = getField(record, field.path);
    if (field.type === 'list') {
      const items = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value.split('\n')
          : [];
      next[field.path] = items
        .map((item) => String(item).trim())
        .filter(Boolean);
    }
    if ((field.type === 'text' || field.type === 'textarea') && typeof value === 'string') {
      next[field.path] = value.trim();
    }
  }
  return next;
}

export function CatalogBrowser() {
  const [types, setTypes] = useState<CatalogTypeInfo[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [records, setRecords] = useState<CatalogRecordSummary[]>([]);
  const [query, setQuery] = useState('');
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogRecordSummary | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadOverview = useCallback(async () => {
    const result = await apiRequest<CatalogOverviewResponse>('/api/catalog');
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTypes(result.data.types);
  }, []);

  const loadRecords = useCallback(async (type: string) => {
    setRecordsLoading(true);
    setError(null);
    const result = await apiRequest<CatalogRecordsResponse>(
      `/api/catalog/${encodeURIComponent(type)}`,
    );
    setRecordsLoading(false);
    if (!result.ok) {
      setRecords([]);
      setError(result.error);
      return;
    }
    setRecords(result.data.records);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await apiRequest<CatalogOverviewResponse>('/api/catalog');
      if (cancelled) return;
      setOverviewLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTypes(result.data.types);
      const first = result.data.types[0];
      if (first) {
        setSelectedType(first.type);
        await loadRecords(first.type);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [loadRecords]);

  const selectedInfo = types.find((item) => item.type === selectedType) ?? null;
  const selectedFormConfig =
    selectedInfo?.editable && selectedType
      ? formConfigs[selectedType as EditableType]
      : null;

  const filteredRecords = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('zh-CN');
    if (!term) return records;
    return records.filter((record) =>
      [
        record.id,
        record.title,
        record.subtitle,
        record.status,
        ...record.tags,
        ...record.meta.flatMap((meta) => [meta.label, meta.value]),
      ]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(term),
    );
  }, [query, records]);

  const totalRecords = types.reduce((sum, item) => sum + item.count, 0);
  const editableCount = types.filter((item) => item.editable).length;

  function selectType(type: string) {
    if (type === selectedType) return;
    setSelectedType(type);
    setQuery('');
    setEditor(null);
    setDeleteTarget(null);
    void loadRecords(type);
  }

  function openCreate() {
    if (!selectedType || !selectedFormConfig) return;
    setEditor({
      mode: 'create',
      type: selectedType as EditableType,
      record: selectedFormConfig.defaults(),
    });
    setFormError(null);
  }

  function openEdit(record: CatalogRecordSummary) {
    if (!selectedType || !selectedFormConfig) return;
    setEditor({
      mode: 'edit',
      type: selectedType as EditableType,
      record: cloneRecord(record.data),
    });
    setFormError(null);
  }

  async function reloadAfterMutation(type: string) {
    await Promise.all([loadOverview(), loadRecords(type)]);
  }

  async function saveRecord() {
    if (!editor || saving) return;
    const config = formConfigs[editor.type];
    const payload = normalizeRecord(editor.record, config);
    if (!String(payload.id ?? '').trim()) {
      setFormError('ID 不能为空');
      return;
    }
    setSaving(true);
    setFormError(null);
    const isEdit = editor.mode === 'edit';
    const url = isEdit
      ? `/api/catalog/${encodeURIComponent(editor.type)}/${encodeURIComponent(String(payload.id))}`
      : `/api/catalog/${encodeURIComponent(editor.type)}`;
    const result = await apiRequest<CatalogMutationResponse>(url, {
      method: isEdit ? 'PUT' : 'POST',
      body: jsonBody(payload),
    });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error);
      toast.error(isEdit ? '保存业务数据失败' : '新增业务数据失败', {
        description: result.error,
      });
      return;
    }
    toast.success(isEdit ? '业务数据已保存' : '业务数据已新增', {
      description: `${result.data.record.id as string}`,
    });
    setEditor(null);
    await reloadAfterMutation(editor.type);
  }

  async function deleteRecord() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setError(null);
    const result = await apiRequest<CatalogMutationResponse>(
      `/api/catalog/${encodeURIComponent(selectedType ?? '')}/${encodeURIComponent(deleteTarget.id)}`,
      { method: 'DELETE' },
    );
    setDeleting(false);
    if (!result.ok) {
      setError(result.error);
      toast.error('删除业务数据失败', { description: result.error });
      return;
    }
    toast.success('业务数据已删除', { description: deleteTarget.id });
    setDeleteTarget(null);
    if (selectedType) await reloadAfterMutation(selectedType);
  }

  function renderField(field: FieldDef) {
    if (!editor) return null;
    const value = getField(editor.record, field.path);
    const id = `catalog-${field.path.replaceAll('.', '-')}`;
    const className = field.span === 2 ? 'field-group col-span-2' : 'field-group';

    if (field.type === 'boolean') {
      return (
        <label key={field.path} className={`${className} flex-row items-center gap-2`}>
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) =>
              setEditor((current) =>
                current
                  ? { ...current, record: setField(current.record, field.path, event.target.checked) }
                  : current,
              )
            }
          />
          <span className="field-label">{field.label}</span>
        </label>
      );
    }

    if (field.type === 'select') {
      return (
        <label key={field.path} className={className}>
          <span className="field-label">{field.label}</span>
          <select
            id={id}
            className="field-select"
            value={String(value ?? '')}
            onChange={(event) =>
              setEditor((current) =>
                current
                  ? { ...current, record: setField(current.record, field.path, event.target.value) }
                  : current,
              )
            }
          >
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (field.type === 'textarea' || field.type === 'list') {
      const listValue = Array.isArray(value) ? value.join('\n') : String(value ?? '');
      return (
        <label key={field.path} className={className}>
          <span className="field-label">{field.label}</span>
          <Textarea
            id={id}
            value={listValue}
            className={field.type === 'textarea' ? 'min-h-[76px]' : 'min-h-[72px] font-mono text-[11px]'}
            onChange={(event) => {
              const nextValue =
                field.type === 'list'
                  ? event.target.value.split('\n')
                  : event.target.value;
              setEditor((current) =>
                current
                  ? { ...current, record: setField(current.record, field.path, nextValue) }
                  : current,
              );
            }}
          />
          {field.help ? <span className="field-hint">{field.help}</span> : null}
        </label>
      );
    }

    return (
      <label key={field.path} className={className}>
        <span className="field-label">{field.label}</span>
        <Input
          id={id}
          type={field.type === 'number' ? 'number' : 'text'}
          value={field.type === 'number' ? String(value ?? 0) : String(value ?? '')}
          disabled={field.path === 'id' && editor.mode === 'edit'}
          placeholder={field.placeholder}
          onChange={(event) => {
            const nextValue =
              field.type === 'number'
                ? event.target.value === ''
                  ? 0
                  : Number(event.target.value)
                : event.target.value;
            setEditor((current) =>
              current
                ? { ...current, record: setField(current.record, field.path, nextValue) }
                : current,
            );
          }}
        />
        {field.help ? <span className="field-hint">{field.help}</span> : null}
      </label>
    );
  }

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div className="min-w-0">
          <p className="eyebrow">BUSINESS DATA / CATALOG</p>
          <h1 className="page-title">业务数据目录</h1>
          <p className="page-subtitle">
            以卡片查看 Agent 依赖的商品、营销、订单、用户、售后与转人工规则。可配置数据支持直接新增、编辑和删除。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{types.length} 类数据</Badge>
          <Badge tone="neutral">{totalRecords} 条记录</Badge>
          <Badge tone="success">{editableCount} 类可编辑</Badge>
        </div>
      </header>

      {error ? (
        <div role="alert" className="alert alert-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="catalog-types" aria-label="数据类型">
        {overviewLoading
          ? Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-lg border bg-card" />
            ))
          : types.map((item) => (
              <button
                key={item.type}
                type="button"
                onClick={() => selectType(item.type)}
                aria-pressed={selectedType === item.type}
                className={`catalog-type ${selectedType === item.type ? 'catalog-type-active' : ''}`}
              >
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <Database className="size-3.5" aria-hidden />
                  {item.label}
                </span>
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  {item.count} 条 · {item.editable ? '可编辑' : '只读'}
                </span>
              </button>
            ))}
      </div>

      <section className="catalog-records-panel">
        <div className="catalog-records-head">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{selectedInfo?.label ?? '选择数据类型'}</h2>
              {selectedInfo ? (
                <Badge tone={selectedInfo.editable ? 'success' : 'neutral'}>
                  {selectedInfo.editable ? '可编辑' : '系统只读'}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {selectedInfo?.description ?? '从上方选择一类业务数据查看卡片。'}
            </p>
          </div>
          <div className="flex w-full max-w-xl flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索当前类型的记录"
                aria-label="搜索业务数据"
                className="pl-8"
              />
            </div>
            <Badge tone="neutral">{filteredRecords.length} 条</Badge>
            {selectedFormConfig ? (
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus aria-hidden />
                {selectedFormConfig.newLabel}
              </Button>
            ) : null}
          </div>
        </div>

        {recordsLoading ? (
          <div role="status" aria-live="polite" className="empty-state">
            <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden />
            <p className="text-xs">正在读取 {selectedInfo?.label ?? '业务数据'}…</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="empty-state">
            <Tags className="size-6" aria-hidden />
            <p className="text-xs font-medium">
              {query ? '没有匹配的记录' : '当前类型暂无记录'}
            </p>
            <p className="text-[11px]">
              {query
                ? '调整搜索词后再试。'
                : selectedInfo?.editable
                  ? '使用“新增”按钮创建第一条记录。'
                  : '当前类型由系统数据提供。'}
            </p>
          </div>
        ) : (
          <div className="catalog-card-grid">
            {filteredRecords.map((record) => (
              <Card key={record.id} className="catalog-card">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xs font-semibold leading-5">{record.title}</h3>
                        <Badge tone="accent">{record.status}</Badge>
                      </div>
                      <p className="mt-1 break-all font-mono text-[9px] text-muted-foreground">
                        {record.id}
                      </p>
                    </div>
                    {selectedInfo?.editable ? (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`编辑 ${record.title}`}
                          onClick={() => openEdit(record)}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`删除 ${record.title}`}
                          onClick={() => setDeleteTarget(record)}
                        >
                          <Trash2 className="size-3.5 text-red-700" aria-hidden />
                        </Button>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                        <LockKeyhole className="size-3" aria-hidden />
                        只读
                      </span>
                    )}
                  </div>

                  <p className="line-clamp-3 text-[11px] leading-5 text-muted-foreground">
                    {record.subtitle}
                  </p>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                    {record.meta.map((meta) => (
                      <div key={`${record.id}-${meta.label}`} className="min-w-0">
                        <dt className="text-muted-foreground">{meta.label}</dt>
                        <dd className="mt-0.5 break-words text-foreground/85">{meta.value}</dd>
                      </div>
                    ))}
                  </dl>

                  {record.tags.length > 0 ? (
                    <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                      {record.tags.map((tag) => (
                        <span key={`${record.id}-${tag}`} className="catalog-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <p className="page-note">
        商品、活动、优惠券、售后政策、FAQ 和转人工规则可配置；订单、用户、工单为系统只读记录。物流信息实时内嵌在订单中，
        不再作为独立业务数据展示或配置。
      </p>

      {editor ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !saving) setEditor(null);
          }}
          title={editor.mode === 'create' ? formConfigs[editor.type].newLabel : '编辑业务数据'}
          description={`${selectedInfo?.label ?? editor.type} · ${editor.mode === 'create' ? '创建新记录' : '修改现有记录'}。保存前由服务端 Zod 契约校验。`}
          className="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="form-grid">{formConfigs[editor.type].fields.map(renderField)}</div>
            {formError ? (
              <div role="alert" className="alert alert-danger">
                <AlertCircle className="size-4 shrink-0" aria-hidden />
                <span>{formError}</span>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditor(null)}
                disabled={saving}
              >
                取消
              </Button>
              <Button type="button" onClick={saveRecord} disabled={saving}>
                {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {deleteTarget ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !deleting) setDeleteTarget(null);
          }}
          title="删除业务数据"
          description="删除后不会自动恢复。Tool 和 Agent 下一次读取数据时会立即使用删除后的结果。"
        >
          <div className="space-y-4">
            <p className="text-xs leading-5">
              确认删除 <strong>{deleteTarget.title}</strong>（<code>{deleteTarget.id}</code>）？
            </p>
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-red-200 text-red-700 hover:bg-red-50"
                onClick={deleteRecord}
                disabled={deleting}
              >
                {deleting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                {deleting ? '删除中…' : '确认删除'}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
