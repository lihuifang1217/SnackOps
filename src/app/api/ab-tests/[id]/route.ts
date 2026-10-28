import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { abTestUpdateSchema, updateAbTest } from '@/lib/ops/ab-tests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, abTestUpdateSchema);
    return jsonResponse({ abTest: await updateAbTest(id, payload) });
  } catch (error) {
    return errorResponse(error);
  }
}
