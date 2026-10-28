import type { Metadata } from 'next';
import { RunsList } from '@/components/agent/runs-list';

export const metadata: Metadata = {
  title: '运行记录',
  description: '浏览 Agent 运行记录、Trace、风险审核与评分报告。',
};

export default function RunsPage() {
  return <RunsList />;
}
