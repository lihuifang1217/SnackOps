'use client';

import { MessagesSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Run } from '@/lib/types';

export function RunConversation({
  run,
  compact = false,
  includeFinal = true,
}: {
  run: Run;
  compact?: boolean;
  includeFinal?: boolean;
}) {
  const history = run.conversationHistory ?? [];
  const messages = [
    ...history.map((message, index) => ({
      key: `history-${index}`,
      role: message.role,
      content: message.content,
      label: '历史消息',
    })),
    { key: 'current', role: 'user' as const, content: run.question, label: '本轮问题' },
    ...(includeFinal && run.finalReply
      ? [{ key: 'reply', role: 'assistant' as const, content: run.finalReply, label: '本轮回复' }]
      : []),
  ];

  if (compact) {
    return (
      <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-medium"><MessagesSquare className="size-3" aria-hidden />对话上下文 · {history.length} 条历史消息</p>
        <div className="space-y-1.5">
          {messages.map((message) => (
            <div key={message.key} className="grid grid-cols-[52px_1fr] gap-2 text-[10px] leading-5">
              <span className={message.role === 'user' ? 'font-medium text-foreground' : 'text-muted-foreground'}>{message.role === 'user' ? '用户' : '助手'}</span>
              <span className="whitespace-pre-wrap">{message.content}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium"><MessagesSquare className="size-3.5 text-primary" aria-hidden />对话上下文</p>
        <Badge tone="neutral">{history.length} 条历史消息</Badge>
        <span className="text-[10px] text-muted-foreground">Run 保存的是发起本次请求时的 conversationHistory，加上本轮问题和回复。</span>
      </div>
      <div className="space-y-2">
        {messages.map((message) => (
          <div key={message.key} className={`rounded-md border px-2.5 py-2 ${message.key === 'current' ? 'border-primary/30 bg-primary/5' : message.key === 'reply' ? 'bg-muted/30' : 'bg-card'}`}>
            <p className="text-[9px] font-medium text-muted-foreground">{message.label} · {message.role === 'user' ? '用户' : '助手'}</p>
            <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5">{message.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
