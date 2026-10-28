import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { llmTestSchema, testLlmConnection } from '@/lib/llm/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, llmTestSchema);
    return jsonResponse(await testLlmConnection(payload));
  } catch (error) {
    return errorResponse(error);
  }
}
