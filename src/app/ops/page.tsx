import { OpsCenter } from '@/components/ops/ops-center';

export const metadata = {
  title: '运营中心',
  description: '从 Run 发现、评分、标注到规则聚类、Prompt 草案和版本回滚的运营闭环。',
};

export default function OpsPage() {
  return <OpsCenter />;
}
