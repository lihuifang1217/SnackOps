import 'server-only';

import type { RegistrySnapshot } from '@/lib/types';
import { listEnabledSkills } from './skills';
import { listEnabledTools } from './tools';

/**
 * Planner / Executor 的统一能力入口：只返回当前启用的 Skill 与 Tool。
 * 每次调用都读取 JSON 注册表，避免缓存导致运营停用后仍被执行。
 */
export async function getEnabledCapabilities(): Promise<RegistrySnapshot> {
  const [skills, tools] = await Promise.all([
    listEnabledSkills(),
    listEnabledTools(),
  ]);
  return {
    skills,
    tools,
    generatedAt: new Date().toISOString(),
  };
}

export { listEnabledSkills, listSkills, getSkillDetail } from './skills';
export { listEnabledTools, listTools, getTool, executeTool } from './tools';
