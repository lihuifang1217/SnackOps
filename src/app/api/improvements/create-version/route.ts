import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { createPromptVersionAndAbDraft, createPromptVersionSchema } from '@/lib/ops/prompt-workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, createPromptVersionSchema);
    return jsonResponse(await createPromptVersionAndAbDraft(payload), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
