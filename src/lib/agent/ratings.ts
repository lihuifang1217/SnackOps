import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { updateCollection, readCollection } from '@/lib/store';
import type { Improvement, Rating, Run } from '@/lib/schemas';
import { getRun } from './runs';
import {
  deriveQuestionType,
  inferImprovementDirection,
  isLowScore,
} from '@/lib/ops/rules';

export const chatRatingRequestSchema = z
  .object({
    runId: z.string().trim().min(1).max(160),
    conversationId: z.string().trim().min(1).max(160).optional(),
    score: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional(),
    question: z.string().trim().max(2000).optional(),
    questionType: z.string().trim().max(80).optional(),
    source: z.enum(['demo', 'agent', 'chat', 'ops', 'api']).optional(),
    conversation: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().max(20000),
          at: z.string().optional(),
        }),
      )
      .max(200)
      .optional(),
  })
  .strict();

export type ChatRatingResult = {
  rating: Rating;
  improvement: Improvement | null;
};

export type RatingFilters = {
  from?: string;
  to?: string;
  score?: number;
  minScore?: number;
  maxScore?: number;
  questionType?: string;
  runId?: string;
};

export async function createChatRating(raw: unknown): Promise<ChatRatingResult> {
  const input = chatRatingRequestSchema.parse(raw);
  const run = await getRun(input.runId);
  const now = new Date().toISOString();
  const question = input.question?.trim() || run.question;
  const answer = run.finalReply ?? '';
  const questionType = input.questionType?.trim() || deriveQuestionType(question);
  const source = input.source ?? 'chat';
  const conversation =
    input.conversation && input.conversation.length > 0
      ? input.conversation
      : [
          { role: 'user' as const, content: question },
          { role: 'assistant' as const, content: answer },
        ];
  const rating: Rating = {
    id: `rating-${Date.now()}-${randomUUID().slice(0, 6)}`,
    runId: run.id,
    conversationId: input.conversationId,
    score: input.score,
    comment: input.comment ?? '',
    question,
    answer,
    questionType,
    source,
    conversation,
    tags: [
      ...(source === 'chat' ? ['chat-session'] : []),
      ...(input.conversationId ? [`conversation:${input.conversationId}`] : []),
      `type:${questionType}`,
    ],
    createdAt: now,
  };
  await updateCollection('ratings', (current) => [rating, ...current]);

  let improvement: Improvement | null = null;
  if (isLowScore(input.score)) {
    const direction = inferImprovementDirection(run);
    const topic = question.slice(0, 36);
    improvement = {
      id: `improvement-${Date.now()}-${randomUUID().slice(0, 6)}`,
      title: `${input.score} 分客服会话：${topic}`,
      source: `评分 ${rating.id} · Run ${run.id}`,
      sourceType: 'low-rating',
      direction,
      description: `用户评分 ${input.score} 分，问题类型为 ${questionType}。`,
      ruleCluster: false,
      sampleRunIds: [run.id],
      suggestedAction: `检查 ${direction} 相关配置，并回放该低分样本。`,
      priority: input.score === 1 ? '高' : '中',
      status: '待处理',
      owner: '待分配',
      createdAt: now,
      updatedAt: now,
    };
    await updateCollection('improvements', (current) => [improvement!, ...current]);
  }

  return { rating, improvement };
}

export async function listChatRatings(
  filters: RatingFilters = {},
): Promise<Rating[]> {
  const [ratings, runs] = await Promise.all([
    readCollection('ratings'),
    readCollection('runs'),
  ]);
  const runMap = new Map(runs.map((run) => [run.id, run]));
  const from = filters.from ? new Date(filters.from).getTime() : null;
  const to = filters.to ? new Date(filters.to).getTime() : null;
  return ratings
    .map((rating) => enrichRating(rating, runMap.get(rating.runId)))
    .filter((rating) => {
      const created = new Date(rating.createdAt).getTime();
      if (from !== null && created < from) return false;
      if (to !== null && created > to) return false;
      if (filters.score !== undefined && rating.score !== filters.score) return false;
      if (filters.minScore !== undefined && rating.score < filters.minScore) return false;
      if (filters.maxScore !== undefined && rating.score > filters.maxScore) return false;
      if (filters.questionType && rating.questionType !== filters.questionType) return false;
      if (filters.runId && rating.runId !== filters.runId) return false;
      return true;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function enrichRating(rating: Rating, run: Run | undefined): Rating {
  return {
    ...rating,
    question: rating.question || run?.question || '',
    answer: rating.answer || run?.finalReply || '',
    questionType: rating.questionType || deriveQuestionType(rating.question || run?.question || ''),
    conversation:
      rating.conversation.length > 0
        ? rating.conversation
        : [
            { role: 'user', content: rating.question || run?.question || '' },
            { role: 'assistant', content: rating.answer || run?.finalReply || '' },
          ],
  };
}

export async function getRatingStats(): Promise<{
  total: number;
  averageScore: number;
  onePointCount: number;
}> {
  const ratings = await readCollection('ratings');
  if (ratings.length === 0) {
    return { total: 0, averageScore: 0, onePointCount: 0 };
  }
  return {
    total: ratings.length,
    averageScore:
      Math.round(
        (ratings.reduce((sum, rating) => sum + rating.score, 0) / ratings.length) * 10,
      ) / 10,
    onePointCount: ratings.filter((rating) => rating.score === 1).length,
  };
}
