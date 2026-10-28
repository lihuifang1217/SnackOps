import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import {
  applyPromptDraft,
  promptApplyRequestSchema,
} from '@/lib/ops/improvements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, promptApplyRequestSchema);
    return jsonResponse(await applyPromptDraft(payload));
  } catch (error) {
    return errorResponse(error);
  }
}
