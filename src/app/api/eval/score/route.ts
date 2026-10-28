import { z } from 'zod';
import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { getRun } from '@/lib/agent/runs';
import { getEvalCase } from '@/lib/eval/cases';
import { scoreEvalCase } from '@/lib/eval/scorer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const scoreSchema = z
  .object({
    caseId: z.string().trim().min(1).max(160),
    runId: z.string().trim().min(1).max(160),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, scoreSchema);
    const [evalCase, run] = await Promise.all([
      getEvalCase(payload.caseId),
      getRun(payload.runId),
    ]);
    return jsonResponse({
      score: scoreEvalCase({ evalCase, run }),
      run,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
