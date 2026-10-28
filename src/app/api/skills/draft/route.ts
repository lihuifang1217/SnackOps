import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { draftSkill, skillDraftRequestSchema } from '@/lib/registry/skill-draft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, skillDraftRequestSchema);
    return jsonResponse(await draftSkill(payload));
  } catch (error) {
    return errorResponse(error);
  }
}
