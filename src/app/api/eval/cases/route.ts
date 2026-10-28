import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { createEvalCase, evalCaseCreateSchema } from '@/lib/eval/cases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, evalCaseCreateSchema);
    return jsonResponse({ case: await createEvalCase(payload) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
