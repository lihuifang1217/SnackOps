import type { Run } from '@/lib/schemas';

export type ImprovementDirection = 'Planner' | 'Skill' | 'Tool' | 'Eval';

export function isLowScore(score: number): boolean {
  return score <= 2;
}

export function deriveQuestionType(question: string): string {
  if (/价格|优惠|券|折|满减|多少钱|预算/.test(question)) return '价格优惠';
  if (/订单|物流|快递|发货|运单/.test(question)) return '订单物流';
  if (/售后|退款|退货|补发|破损|缺件/.test(question)) return '售后';
  if (/过敏|儿童|孕妇|安全|花生|坚果/.test(question)) return '过敏安全';
  if (/投诉|生气|差评|赔偿/.test(question)) return '投诉';
  if (/中奖|验证码|转账|诈骗/.test(question)) return '诈骗';
  if (/推荐|零食|好吃|口味|送礼/.test(question)) return '商品推荐';
  return '其他';
}

export function inferImprovementDirection(run: Run): ImprovementDirection {
  if (
    run.steps.some((step) => step.type === 'tool' && step.status === 'ERROR') ||
    run.validation?.errors.some((issue) => issue.code.startsWith('MISSING_') && issue.code.includes('TOOL'))
  ) {
    return 'Tool';
  }
  if (!run.plan || (run.validation?.errors.length ?? 0) > 0) {
    return 'Planner';
  }
  if (
    run.status === '失败' ||
    run.evaluation?.checks.some(
      (check) => check.status === 'FAIL' && /最终回复|Skill/.test(check.label),
    )
  ) {
    return 'Skill';
  }
  return 'Eval';
}

export function directionRecommendations(direction: ImprovementDirection): string[] {
  const shared = [
    'Planner：补充场景识别、强制能力与 fallback 规则',
    'Skill：补强触发条件、指令步骤和输出边界',
    'Tool：修复参数推导、错误处理和真实数据证据',
    'Eval：沉淀回归用例并明确期望能力与风险结果',
  ];
  return [
    ...shared.filter((item) => item.startsWith(direction)),
    ...shared.filter((item) => !item.startsWith(direction)),
  ];
}
