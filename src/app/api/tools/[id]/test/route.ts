import { errorResponse, jsonResponse, readRequestBody } from '@/lib/api';
import { executeTool } from '@/lib/registry/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const input = await readRequestBody(request);
    return jsonResponse(await executeTool(id, input));
  } catch (error) {
    return errorResponse(error);
  }
}
