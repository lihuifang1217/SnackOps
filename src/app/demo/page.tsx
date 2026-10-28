import type { Metadata } from 'next';
import { DemoChat } from '@/components/agent/demo-chat';

export const metadata: Metadata = {
  title: '零食小助手',
  description: '零食小助手：通过产品化聊天界面调用同一个 Agent 主链路，支持自动评分。',
};

export default function DemoPage() {
  return <DemoChat />;
}
