import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import {
  getLlmConfigView,
  llmConfigUpdateSchema,
  updateLlmConfig,
} from '@/lib/llm/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return jsonResponse(await getLlmConfigView());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await parseJsonBody(request, llmConfigUpdateSchema);
    return jsonResponse(await updateLlmConfig(payload));
  } catch (error) {
    return errorResponse(error);
  }
}
