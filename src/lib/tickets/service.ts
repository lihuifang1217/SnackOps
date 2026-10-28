import 'server-only';

import { randomUUID } from 'node:crypto';
import { readCollection, updateCollection } from '@/lib/store';
import { updateRun } from '@/lib/agent/runs';
import type { Run, Ticket } from '@/lib/schemas';

type TicketReason = {
  code: string;
  queue: string;
  priority: '普通' | '紧急';
};

function reasonFromRun(run: Run, text: string): TicketReason {
  const flags = run.riskResult?.flags ?? [];
  if (flags.includes('fraud_suspected') || /诈骗|中奖|验证码|转账/.test(text)) {
    return { code: 'fraud_suspected', queue: '安全核验', priority: '紧急' };
  }
  if (flags.includes('allergy') || /过敏|孩子|孕妇|特殊人群/.test(text)) {
    return { code: 'allergy_safety', queue: '过敏与特殊人群', priority: '紧急' };
  }
  if (flags.includes('complaint') || /投诉|食品安全|身体不适/.test(text)) {
    return { code: 'complaint', queue: '投诉处理', priority: '紧急' };
  }
  if (/物流|快递|运单|派送/.test(text)) {
    return { code: 'logistics', queue: '订单物流', priority: '普通' };
  }
  if (/订单|售后|退款|补发|破损/.test(text)) {
    return { code: 'after_sales', queue: '售后处理', priority: '普通' };
  }
  return {
    code: run.handoff ? 'manual_handoff' : 'human_review',
    queue: '人工客服',
    priority: run.riskResult?.riskLevel === 'high' ? '紧急' : '普通',
  };
}

function conversationFor(run: Run): Ticket['conversationHistory'] {
  const messages = [...run.conversationHistory];
  const last = messages.at(-1);
  if (!last || last.role !== 'user' || last.content !== run.question) {
    messages.push({ role: 'user', content: run.question });
  }
  if (run.finalReply?.trim()) {
    const lastMessage = messages.at(-1);
    if (!lastMessage || lastMessage.role !== 'assistant' || lastMessage.content !== run.finalReply) {
      messages.push({ role: 'assistant', content: run.finalReply });
    }
  }
  return messages;
}

function knownFactsFor(run: Run): string[] {
  const facts = new Set<string>();
  const text = `${run.question} ${run.finalReply ?? ''}`;
  const orderNo = text.match(/SN\d{8,}/)?.[0];
  const trackingNo = text.match(/SF\d{8,}/)?.[0];
  if (orderNo) facts.add(`订单号：${orderNo}`);
  if (trackingNo) facts.add(`运单号：${trackingNo}`);
  for (const flag of run.riskResult?.flags ?? []) facts.add(`风险标记：${flag}`);
  for (const note of run.riskResult?.notes ?? []) facts.add(note);
  if (run.plan?.goal) facts.add(`Planner 目标：${run.plan.goal}`);
  if (run.riskResult) facts.add(`risk-check：${run.riskResult.decision} / ${run.riskResult.riskLevel}`);
  return [...facts];
}

function missingInfoFor(run: Run): string[] {
  const missing = new Set<string>();
  const text = `${run.question} ${run.finalReply ?? ''}`;
  if (/订单|售后|退款|补发/.test(text) && !/SN\d{8,}/.test(text)) missing.add('订单号');
  if (/物流|快递|运单/.test(text) && !/SF\d{8,}/.test(text)) missing.add('运单号');
  if (run.riskResult?.riskLevel === 'high') missing.add('用户身份与事实证据需人工核验');
  if (run.plan?.fallback?.reason) missing.add(run.plan.fallback.reason);
  return [...missing];
}

export async function ensureTicketForRun(input: {
  run: Run;
  reason?: string;
  by?: string;
}): Promise<Ticket> {
  const { run } = input;
  const tickets = await readCollection('tickets');
  const existing = tickets.find((ticket) => ticket.runId === run.id);
  if (existing) {
    if (input.reason?.trim() && input.reason.trim() !== existing.reason) {
      await updateCollection('tickets', (current) =>
        current.map((ticket) =>
          ticket.id === existing.id
            ? {
                ...ticket,
                reason: input.reason!.trim(),
                priority: reasonFromRun(run, `${run.question} ${input.reason}`).priority,
                updatedAt: new Date().toISOString(),
              }
            : ticket,
        ),
      );
    }
    if (run.ticketId !== existing.id) {
      await updateRun(run.id, (current) => ({ ...current, ticketId: existing.id }));
    }
    return existing;
  }

  const reasonText =
    input.reason?.trim() ||
    run.handoff?.reason ||
    run.riskResult?.notes.join('；') ||
    run.plan?.fallback?.reason ||
    '需要人工进一步跟进';
  const reason = reasonFromRun(run, `${run.question} ${reasonText}`);
  const now = new Date().toISOString();
  const ticket: Ticket = {
    id: `TK-${Date.now()}-${randomUUID().slice(0, 6)}`,
    customer: run.source === 'demo' ? 'Demo 访客' : run.source === 'workbench' ? 'Agent 工作台用户' : '在线用户',
    subject: run.question.slice(0, 100),
    channel: run.source === 'demo' ? 'Demo' : run.source === 'workbench' ? 'Agent 工作台' : '小程序',
    status: '待处理',
    priority: reason.priority,
    skill: run.plan?.selectedSkills.length ? run.plan.selectedSkills.join(' / ') : '人工客服',
    assignee: '未分配',
    updatedAt: now,
    runId: run.id,
    conversationId: run.conversationId,
    source: run.source,
    reasonCode: reason.code,
    reason: reasonText,
    knownFacts: knownFactsFor(run),
    missingInfo: missingInfoFor(run),
    suggestedQueue: reason.queue,
    userMessage: run.question,
    conversationHistory: conversationFor(run),
  };
  await updateCollection('tickets', (current) => [ticket, ...current]);
  await updateRun(run.id, (current) => ({ ...current, ticketId: ticket.id }));
  return ticket;
}
