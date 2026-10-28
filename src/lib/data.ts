import 'server-only';

import { collectionSchemas } from './schemas';
import { readCollection } from './store';
import type {
  DashboardSnapshot,
  HealthSnapshot,
  RunTrendPoint,
} from './types';


function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Shanghai',
  }).format(date);
}

function dateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(date);
}

function shanghaiDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day') };
}

export function buildRunTrend(
  runs: DashboardSnapshot['recentRuns'],
  days = 7,
  now = new Date(),
): RunTrendPoint[] {
  // 以 Asia/Shanghai 的“今天”为锚点，再生成稳定的日期键。
  // 不能使用 new Date().setHours(0,0,0,0)，因为生产服务器可能运行在 UTC，
  // 会把图表窗口与北京时间错开 8 小时。
  const anchor = shanghaiDateParts(now);
  const buckets = new Map<string, RunTrendPoint>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    // 12:00 UTC = 20:00 Asia/Shanghai，确保日期与上海时区一致。
    const day = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day - offset, 12));
    buckets.set(dateKey(day), {
      label: dateLabel(day),
      success: 0,
      handoff: 0,
      failed: 0,
    });
  }

  for (const run of runs) {
    const bucket = buckets.get(dateKey(new Date(run.createdAt)));
    if (!bucket) continue;
    if (run.status === '成功') bucket.success += 1;
    if (run.status === '转人工') bucket.handoff += 1;
    if (run.status === '失败') bucket.failed += 1;
  }

  return [...buckets.values()];
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [products, tickets, skills, tools, runs, evalCases] =
    await Promise.all([
      readCollection('products'),
      readCollection('tickets'),
      readCollection('skills'),
      readCollection('tools'),
      readCollection('runs'),
      readCollection('eval_cases'),
    ]);

  const pendingTickets = tickets
    .filter((ticket) => ticket.status !== '已解决')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 5);

  const recentRuns = [...runs]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5);

  return {
    counts: {
      products: products.length,
      lowStockProducts: products.filter((product) => product.stock <= 30).length,
      pendingTickets: tickets.filter((ticket) => ticket.status !== '已解决').length,
      enabledSkills: skills.filter((skill) => skill.enabled).length,
      enabledTools: tools.filter((tool) => tool.enabled).length,
      evalCases: evalCases.filter((testCase) => testCase.enabled).length,
    },
    pendingTickets,
    recentRuns,
    runTrend: buildRunTrend(runs, 7),
    generatedAt: new Date().toISOString(),
  };
}

export async function getHealthSnapshot(): Promise<HealthSnapshot> {
  const [llmConfig, products, tickets, skills, tools] = await Promise.all([
    readCollection('llm-config'),
    readCollection('products'),
    readCollection('tickets'),
    readCollection('skills'),
    readCollection('tools'),
  ]);

  return {
    status: 'ok',
    storage: 'json',
    datasetCount: Object.keys(collectionSchemas).length,
    productCount: products.length,
    pendingTicketCount: tickets.filter((ticket) => ticket.status !== '已解决').length,
    enabledSkillCount: skills.filter((skill) => skill.enabled).length,
    enabledToolCount: tools.filter((tool) => tool.enabled).length,
    provider: llmConfig.provider,
    providerConfigured: llmConfig.configured,
    checkedAt: new Date().toISOString(),
  };
}
