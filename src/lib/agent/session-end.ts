import type { Run } from '@/lib/schemas';

const CLOSING_PATTERN =
  /^(谢谢|感谢|好的|好|行|可以|不用了|没有了|解决了|明白了|收到|再见|拜拜|辛苦了|ok|okay)[！。!,.，\s]*$/i;
const CLOSURE_PHRASE = /(不用了|没有了|解决了|没问题了|没有其他|就这些|再见|拜拜)/;
const ACTIVE_ISSUE =
  /订单|物流|价格|优惠|券|过敏|投诉|退款|退货|补发|推荐|购买|买点|查一下|怎么|为什么|多少|问题/;

/**
 * 只根据明确的收尾话语判断会话结束，避免 Agent 在用户仍在咨询时提前评分。
 */
export function detectConversationEnd(input: {
  userInput: string;
  finalReply: string;
  status: Run['status'];
}): boolean {
  if (input.status === '失败') return false;
  const text = input.userInput.trim();
  if (!text) return false;
  if (CLOSING_PATTERN.test(text)) return true;
  if (CLOSURE_PHRASE.test(text) && !ACTIVE_ISSUE.test(text)) return true;
  return false;
}
