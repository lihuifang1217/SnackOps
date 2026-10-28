import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { toolUpdatePayloadSchema, updateTool } from '@/lib/registry/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, toolUpdatePayloadSchema);
    return jsonResponse({ tool: await updateTool(id, payload) });
  } catch (error) {
    return errorResponse(error);
  }
}
