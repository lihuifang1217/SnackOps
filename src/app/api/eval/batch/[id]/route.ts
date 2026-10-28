import { errorResponse, jsonResponse } from '@/lib/api';
import { deleteBatch, readBatch } from '@/lib/eval/batch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return jsonResponse({ batch: await readBatch(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return jsonResponse({ ok: true, ...(await deleteBatch(id)) });
  } catch (error) {
    return errorResponse(error);
  }
}
