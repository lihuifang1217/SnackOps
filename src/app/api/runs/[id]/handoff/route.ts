import { errorResponse, jsonResponse } from '@/lib/api';
import { parseJsonBody } from '@/lib/api';
import { handoffRequestSchema } from '@/lib/agent/request-schemas';
import { getRun, markRunHandoff } from '@/lib/agent/runs';
import { ensureTicketForRun } from '@/lib/tickets/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, handoffRequestSchema);
    const run = await markRunHandoff({
      runId: id,
      reason: payload.reason,
      by: payload.by ?? '运营管理员',
    });
    const ticket = await ensureTicketForRun({
      run,
      reason: payload.reason,
      by: payload.by ?? '运营管理员',
    });
    return jsonResponse({ run: await getRun(run.id), ticket });
  } catch (error) {
    return errorResponse(error);
  }
}
