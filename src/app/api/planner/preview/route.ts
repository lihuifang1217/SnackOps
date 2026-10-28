import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { previewPlanner } from '@/lib/agent/planner-preview';
import { plannerPreviewRequestSchema } from '@/lib/agent/request-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, plannerPreviewRequestSchema);
    return jsonResponse(await previewPlanner(payload));
  } catch (error) {
    return errorResponse(error);
  }
}
