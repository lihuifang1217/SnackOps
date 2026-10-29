import { errorResponse, jsonResponse } from '@/lib/api';
import { confirmAbTest } from '@/lib/ops/ab-tests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return jsonResponse(await confirmAbTest(id));
  } catch (error) {
    return errorResponse(error);
  }
}
