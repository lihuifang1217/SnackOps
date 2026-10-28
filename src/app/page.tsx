import type { Metadata } from 'next';
import { AgentWorkbench } from '@/components/agent/workbench';

export const metadata: Metadata = {
  title: 'Agent 工作台',
  description: '运行零食客服 Agent 主链路，查看 Planner、Trace、风险审核与最终回复。',
};

export default function AgentWorkbenchPage() {
  return <AgentWorkbench />;
}
