import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { evalConfigUpdateSchema, getEvalConfig, updateEvalConfig } from '@/lib/eval/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return jsonResponse({ config: await getEvalConfig() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await parseJsonBody(request, evalConfigUpdateSchema);
    return jsonResponse({ config: await updateEvalConfig(payload) });
  } catch (error) {
    return errorResponse(error);
  }
}
