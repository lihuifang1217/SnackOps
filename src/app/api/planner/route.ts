import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { getPlannerOverview } from '@/lib/agent/planner-preview';
import {
  plannerConfigUpdateSchema,
  updatePlannerConfig,
} from '@/lib/agent/planner-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return jsonResponse(await getPlannerOverview());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await parseJsonBody(request, plannerConfigUpdateSchema);
    const config = await updatePlannerConfig(payload);
    return jsonResponse({ config });
  } catch (error) {
    return errorResponse(error);
  }
}
