import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import {
  annotationPromoteSchema,
  promoteAnnotation,
} from '@/lib/ops/annotations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, annotationPromoteSchema);
    return jsonResponse(await promoteAnnotation(id, payload));
  } catch (error) {
    return errorResponse(error);
  }
}
