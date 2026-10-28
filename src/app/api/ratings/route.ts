import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import {
  chatRatingRequestSchema,
  createChatRating,
  getRatingStats,
  listChatRatings,
} from '@/lib/agent/ratings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const toNumber = (key: string) => {
      const value = searchParams.get(key);
      return value === null ? undefined : Number(value);
    };
    const ratings = await listChatRatings({
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      score: toNumber('score'),
      minScore: toNumber('minScore'),
      maxScore: toNumber('maxScore'),
      questionType: searchParams.get('questionType') ?? undefined,
      runId: searchParams.get('runId') ?? undefined,
    });
    const stats = await getRatingStats();
    return jsonResponse({ ratings, total: ratings.length, stats });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, chatRatingRequestSchema);
    return jsonResponse(await createChatRating(payload), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
