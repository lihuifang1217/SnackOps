import Link from 'next/link';
import {
  ArrowRight,
  CircleDot,
  FlaskConical,
  Inbox,
  Package,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { HealthPanel } from '@/components/health-panel';
import { OverviewLiveBar } from '@/components/overview/overview-live-bar';
import { RunTrendChart } from '@/components/run-trend-chart';
import { getDashboardSnapshot, getHealthSnapshot } from '@/lib/data';
import type { Run, Ticket } from '@/lib/types';

export const dynamic = 'force-dynamic';

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
}

function ticketTone(status: Ticket['status']) {
  if (status === '待处理') return 'warning' as const;
  if (status === '处理中') return 'accent' as const;
  return 'success' as const;
}

function runTone(status: Run['status']) {
  if (status === '成功') return 'success' as const;
  if (status === '转人工') return 'warning' as const;
  if (status === '失败') return 'danger' as const;
  return 'accent' as const;
}

const metrics = [
  {
    key: 'tickets',
    label: '待处理工单',
    hint: '含处理中的跟进会话',
    icon: Inbox,
    tone: 'text-orange-800 bg-orange-50 border-orange-200',
  },
  {
    key: 'skills',
    label: '已启用技能',
    hint: '可参与后续 Planner 规划',
    icon: Sparkles,
    tone: 'text-amber-900 bg-amber-50 border-amber-200',
  },
  {
    key: 'tools',
    label: '已启用工具',
    hint: '均为本地只读工具',
    icon: Wrench,
    tone: 'text-stone-800 bg-stone-100 border-stone-200',
  },
  {
    key: 'evals',
    label: '启用评测用例',
    hint: '用于后续回归批次',
    icon: FlaskConical,
    tone: 'text-emerald-900 bg-emerald-50 border-emerald-200',
  },
] as const;

export default async function OverviewPage() {
  const [dashboard, health] = await Promise.all([
    getDashboardSnapshot(),
    getHealthSnapshot(),
  ]);

  const values = {
    tickets: dashboard.counts.pendingTickets,
    skills: dashboard.counts.enabledSkills,
    tools: dashboard.counts.enabledTools,
    evals: dashboard.counts.evalCases,
  };

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div className="min-w-0">
          <p className="eyebrow">SNACKOPS / 运营总览</p>
          <h1 className="page-title">零食客服运营台</h1>
          <p className="page-subtitle">
            以本地业务数据为底座，统一管理客服 Agent 的 Skill、Tool、运行记录与评测资产。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Agent 主链路</Badge>
          <Badge tone="neutral">JSON 服务端存储</Badge>
        </div>
      </header>

      <OverviewLiveBar generatedAt={dashboard.generatedAt} />

      <section aria-label="关键指标" className="metric-grid">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.key} className="metric-card">
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-muted-foreground">{metric.label}</p>
                  <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
                    {values[metric.key]}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{metric.hint}</p>
                </div>
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${metric.tone}`}>
                  <Icon className="size-4" aria-hidden />
                </span>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <div className="dashboard-grid">
        <RunTrendChart data={dashboard.runTrend} />
        <HealthPanel initial={health} />

        <Card className="min-w-0">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>待跟进工单</CardTitle>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                按最近更新时间排序，优先展示未解决会话。
              </p>
            </div>
            <Badge tone={dashboard.pendingTickets.some((ticket) => ticket.priority === '紧急') ? 'warning' : 'neutral'}>
              {dashboard.pendingTickets.length} 条
            </Badge>
          </CardHeader>
          <CardContent className="px-0 pb-0 pt-4">
            {dashboard.pendingTickets.length === 0 ? (
              <div className="empty-state">
                <Inbox className="size-6" aria-hidden />
                <p className="text-xs font-medium">当前没有待处理工单</p>
                <p className="text-[11px]">新工单进入后会出现在这里。</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">工单</th>
                      <th scope="col">客户 / 渠道</th>
                      <th scope="col">技能</th>
                      <th scope="col">优先级</th>
                      <th scope="col">状态</th>
                      <th scope="col">更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.pendingTickets.map((ticket) => (
                      <tr key={ticket.id}>
                        <td>
                          <p className="font-medium">{ticket.subject}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{ticket.id}</p>
                        </td>
                        <td>
                          <p>{ticket.customer}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">{ticket.channel}</p>
                        </td>
                        <td className="text-muted-foreground">{ticket.skill}</td>
                        <td>
                          <Badge tone={ticket.priority === '紧急' ? 'danger' : 'neutral'}>
                            {ticket.priority}
                          </Badge>
                        </td>
                        <td>
                          <Badge tone={ticketTone(ticket.status)}>{ticket.status}</Badge>
                        </td>
                        <td className="tabular-nums text-muted-foreground">
                          {formatDateTime(ticket.updatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <span className="text-[10px] text-muted-foreground">数据来源：tickets.json</span>
            <Button asChild variant="outline" size="sm">
              <Link href="/tickets">
                查看工单模块
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardFooter>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>最近运行</CardTitle>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                最近 5 次 Agent 处理记录。
              </p>
            </div>
            <CircleDot className="size-4 text-primary" aria-hidden />
          </CardHeader>
          <CardContent className="px-0 pb-0 pt-4">
            {dashboard.recentRuns.length === 0 ? (
              <div className="empty-state">
                <Package className="size-6" aria-hidden />
                <p className="text-xs font-medium">还没有运行记录</p>
                <p className="text-[11px]">Agent 工作台接入后，执行记录会写入 runs.json。</p>
              </div>
            ) : (
              <ul className="divide-y">
                {dashboard.recentRuns.map((run) => (
                  <li key={run.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-xs leading-5">{run.question}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {formatDateTime(run.createdAt)} · {(run.durationMs / 1000).toFixed(1)} 秒 ·{' '}
                        {run.steps.filter((step) => step.type === 'tool').length} 个工具
                      </p>
                    </div>
                    <Badge tone={runTone(run.status)}>{run.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <span className="text-[10px] text-muted-foreground">数据来源：runs.json</span>
            <Button asChild variant="outline" size="sm">
              <Link href="/runs">
                查看运行记录
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>

      <p className="page-note">
        本页通过服务端 `getDashboardSnapshot()` 实时读取 JSON 数据，生成时间{' '}
        {formatDateTime(dashboard.generatedAt)}；同一数据源可通过 `GET /api/overview` 获取。运行记录与风险评估来自服务端持久化 RunRecord。
      </p>
    </div>
  );
}
