import type { BadgeTone } from '@/components/ui/badge';

export const moduleKeys = ['tickets', 'evals', 'settings'] as const;

export type ModuleKey = (typeof moduleKeys)[number];

export type ModuleDefinition = {
  key: ModuleKey;
  navLabel: string;
  title: string;
  description: string;
  status: string;
  tone: BadgeTone;
  dataFiles: string[];
  nextSteps: string[];
};

export const modules: Record<ModuleKey, ModuleDefinition> = {
  tickets: {
    key: 'tickets',
    navLabel: '客服工单',
    title: '客服工单',
    description: '集中处理待跟进会话、优先级与人工接管记录。',
    status: '骨架已建立',
    tone: 'accent',
    dataFiles: ['tickets.json', 'orders.json', 'handoff-rules.json'],
    nextSteps: ['工单列表与筛选', '意图标签与优先级', '人工接管操作与审计'],
  },
  evals: {
    key: 'evals',
    navLabel: '评测中心',
    title: '评测中心',
    description: '组织评测用例、批次结果和 A/B 实验。',
    status: '骨架已建立',
    tone: 'accent',
    dataFiles: ['eval_cases.json', 'eval_batches.json', 'eval-config.json', 'ab-tests.json', 'improvements.json'],
    nextSteps: ['用例编辑器', '批次执行与失败明细', 'A/B 实验与改进闭环'],
  },
  settings: {
    key: 'settings',
    navLabel: '工作区设置',
    title: '工作区设置',
    description: '配置模型 Provider、保底策略和运行参数。',
    status: '骨架已建立',
    tone: 'accent',
    dataFiles: ['llm-config.json', 'runtime-fallback.json', 'tools-config.json'],
    nextSteps: ['Provider 与模型选择', '连接测试', '转人工保底策略'],
  },
};

export function isModuleKey(value: string): value is ModuleKey {
  return (moduleKeys as readonly string[]).includes(value);
}
