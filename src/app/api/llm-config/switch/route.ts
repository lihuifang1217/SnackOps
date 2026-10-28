import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { llmSwitchSchema, switchProvider } from '@/lib/llm/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, llmSwitchSchema);
    return jsonResponse(await switchProvider(payload));
  } catch (error) {
    return errorResponse(error);
  }
}
