import type { Metadata } from 'next';
import { PlannerManager } from '@/components/planner/planner-manager';

export const metadata: Metadata = {
  title: 'Planner 管理',
  description: '查看 Planner 版本与 Prompt，选择启用能力并预览计划与校验结果。',
};

export default function PlannerPage() {
  return <PlannerManager />;
}
