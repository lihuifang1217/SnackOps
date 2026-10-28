import type { Metadata } from 'next';
import { ToolsManager } from '@/components/registry/tools-manager';

export const metadata: Metadata = {
  title: 'Tool 注册中心',
  description: '配置工具名称与能力描述，查看执行方式、数据源、完整 JSON 并运行真实数据测试。',
};

export default function ToolsPage() {
  return <ToolsManager />;
}
