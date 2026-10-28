import { errorResponse, jsonResponse } from '@/lib/api';
import { copyEvalCase } from '@/lib/eval/cases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return jsonResponse({ case: await copyEvalCase(id) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
