import { errorResponse, jsonResponse } from '@/lib/api';
import { parseJsonBody } from '@/lib/api';
import { annotateRequestSchema } from '@/lib/agent/request-schemas';
import { annotateRun } from '@/lib/agent/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, annotateRequestSchema);
    const annotation = await annotateRun({
      runId: id,
      label: payload.label,
      note: payload.note,
      annotator: payload.annotator ?? '运营管理员',
    });
    return jsonResponse({ annotation });
  } catch (error) {
    return errorResponse(error);
  }
}
