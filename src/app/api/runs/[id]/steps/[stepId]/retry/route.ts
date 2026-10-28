import { errorResponse, jsonResponse } from '@/lib/api';
import { retryToolStep } from '@/lib/agent/step-retry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; stepId: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { id, stepId } = await context.params;
    return jsonResponse(await retryToolStep({ runId: id, stepId }));
  } catch (error) {
    return errorResponse(error);
  }
}
