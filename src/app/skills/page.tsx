import type { Metadata } from 'next';
import { SkillsManager } from '@/components/registry/skills-manager';

export const metadata: Metadata = {
  title: 'Skill 注册中心',
  description: '查看、创建、配置、测试与版本管理客服 Agent 业务技能，支持 AI 草案。',
};

export default function SkillsPage() {
  return <SkillsManager />;
}
