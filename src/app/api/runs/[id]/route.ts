import { errorResponse, jsonResponse } from '@/lib/api';
import { getAnnotations, getRun } from '@/lib/agent/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const [run, annotations] = await Promise.all([getRun(id), getAnnotations(id)]);
    return jsonResponse({ run, annotations });
  } catch (error) {
    return errorResponse(error);
  }
}
