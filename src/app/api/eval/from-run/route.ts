import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { createCaseFromRun, evalCaseFromRunSchema } from '@/lib/eval/cases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, evalCaseFromRunSchema);
    return jsonResponse({ case: await createCaseFromRun(payload) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
