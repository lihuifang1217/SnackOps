import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import {
  deleteEvalCase,
  evalCaseUpdateSchema,
  updateEvalCase,
} from '@/lib/eval/cases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, evalCaseUpdateSchema);
    return jsonResponse({ case: await updateEvalCase(id, payload) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await deleteEvalCase(id);
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
