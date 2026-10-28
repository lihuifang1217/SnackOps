import type { Metadata } from 'next';
import { RunDetailView } from '@/components/agent/run-detail';

export const metadata: Metadata = {
  title: '运行详情',
  description: '查看完整 RunRecord、Trace、风险、重试、人工接管和标注。',
};

type PageProps = {
  params: Promise<{ runId: string }>;
};

export default async function RunDetailPage({ params }: PageProps) {
  const { runId } = await params;
  return <RunDetailView runId={runId} />;
}
