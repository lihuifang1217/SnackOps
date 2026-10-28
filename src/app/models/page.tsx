import type { Metadata } from 'next';
import { ModelsManager } from '@/components/models/models-manager';

export const metadata: Metadata = {
  title: '模型管理',
  description: '查看和切换 LLM Provider、默认模型、环境变量状态并测试连接。',
};

export default function ModelsPage() {
  return <ModelsManager />;
}
