import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import {
  annotationUpdateSchema,
  getAnnotation,
  updateAnnotation,
} from '@/lib/ops/annotations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return jsonResponse({ annotation: await getAnnotation(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, annotationUpdateSchema);
    return jsonResponse({ annotation: await updateAnnotation(id, payload) });
  } catch (error) {
    return errorResponse(error);
  }
}
