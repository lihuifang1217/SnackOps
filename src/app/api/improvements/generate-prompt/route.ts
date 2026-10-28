import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import {
  generatePromptDraft,
  promptDraftRequestSchema,
} from '@/lib/ops/improvements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, promptDraftRequestSchema);
    return jsonResponse(await generatePromptDraft(payload));
  } catch (error) {
    return errorResponse(error);
  }
}
