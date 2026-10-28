import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
import Link from 'next/link';
import { ArrowRight, LifeBuoy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/client';
import { readCollection } from '@/lib/store';

export const metadata: Metadata = {
  title: '客服工单',
  description: '人工接管自动生成的客服工单，带入会话历史、优先级、原因、已知事实与缺失信息。',
};

const SOURCE_LABEL: Record<string, string> = {
  demo: 'Demo',
  workbench: 'Agent 工作台',
  api: 'Agent API',
  retry: '重试运行',
  manual: '人工',
};

function facts(values: string[]): string {
  return values.length > 0 ? values.join('；') : '—';
}

export default async function TicketsPage() {
  const tickets = await readCollection('tickets');
  const sorted = [...tickets].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const pending = sorted.filter((ticket) => ticket.status === '待处理').length;
  const urgent = sorted.filter((ticket) => ticket.priority === '紧急').length;

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">TICKETS / HUMAN HANDOFF</p>
          <h1 className="page-title">客服工单</h1>
          <p className="page-subtitle">Demo、Agent 工作台转人工和 Run 人工接管会自动生成工单，并带入会话历史与风险上下文。</p>
        </div>
        <Badge tone="accent">{pending} 待处理</Badge>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground">工单总数</p><p className="mt-1 text-xl font-semibold">{sorted.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground">待处理</p><p className="mt-1 text-xl font-semibold">{pending}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground">紧急</p><p className="mt-1 text-xl font-semibold">{urgent}</p></CardContent></Card>
      </div>

      <div className="space-y-3">
        {sorted.length === 0 ? <div className="empty-state rounded-xl border bg-card"><LifeBuoy className="size-7 text-primary" aria-hidden /><p className="text-sm font-medium">暂无工单</p></div> : sorted.map((ticket) => (
          <Card key={ticket.id} id={ticket.id} className="scroll-mt-24">
            <CardHeader className="gap-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><div className="flex flex-wrap items-center gap-1.5"><Badge tone={ticket.priority === '紧急' ? 'danger' : 'neutral'}>{ticket.priority}</Badge><Badge tone={ticket.status === '待处理' ? 'warning' : 'success'}>{ticket.status}</Badge><span className="font-mono text-[10px] text-muted-foreground">{ticket.id}</span><span className="text-[10px] text-muted-foreground">{SOURCE_LABEL[ticket.source] ?? ticket.source} · {ticket.channel}</span></div><CardTitle className="mt-1 text-sm">{ticket.subject}</CardTitle></div>
                <span className="text-[10px] text-muted-foreground">{formatDateTime(ticket.updatedAt)}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">客户：{ticket.customer} · Skill：{ticket.skill} · 建议队列：{ticket.suggestedQueue} · 原因码：{ticket.reasonCode}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] leading-5 text-amber-900"><span className="font-semibold">转人工原因：</span>{ticket.reason || '—'}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border px-2.5 py-2 text-[10px]"><p className="font-semibold">用户消息</p><p className="mt-1 whitespace-pre-wrap leading-5">{ticket.userMessage || '—'}</p><p className="mt-2 font-semibold">已知事实</p><p className="mt-1 whitespace-pre-wrap leading-5 text-muted-foreground">{facts(ticket.knownFacts)}</p></div>
                <div className="rounded-md border px-2.5 py-2 text-[10px]"><p className="font-semibold">缺失信息</p><p className="mt-1 whitespace-pre-wrap leading-5 text-muted-foreground">{facts(ticket.missingInfo)}</p><p className="mt-2 font-semibold">建议队列</p><p className="mt-1 leading-5">{ticket.suggestedQueue}</p></div>
              </div>
              <div className="rounded-md border px-2.5 py-2 text-[10px]"><p className="font-semibold">会话历史（{ticket.conversationHistory.length}）</p><div className="mt-1 space-y-1">{ticket.conversationHistory.length === 0 ? <p className="text-muted-foreground">无历史消息</p> : ticket.conversationHistory.map((message, index) => <p key={`${ticket.id}-${index}`} className={message.role === 'user' ? 'text-foreground' : 'text-muted-foreground'}>{message.role === 'user' ? '用户' : '助手'}：{message.content}</p>)}</div></div>
              {ticket.runId ? <Link href={`/runs/${ticket.runId}`} className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline">查看关联 Run <ArrowRight className="size-3" aria-hidden /></Link> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
