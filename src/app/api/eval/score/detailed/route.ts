import { z } from 'zod';
import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { getRun } from '@/lib/agent/runs';
import { getEvalCase } from '@/lib/eval/cases';
import { getEvalConfig } from '@/lib/eval/config';
import { judgeEvalCase } from '@/lib/eval/judge';
import { scoreEvalCaseDetailed } from '@/lib/eval/detailed-score';
import { enqueueEvalFailure } from '@/lib/ops/annotations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    caseId: z.string().trim().min(1).max(160),
    runId: z.string().trim().min(1).max(160),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, schema);
    const [evalCase, run, config] = await Promise.all([
      getEvalCase(payload.caseId),
      getRun(payload.runId),
      getEvalConfig(),
    ]);
    const judge = await judgeEvalCase({ evalCase, run, config });
    const score = scoreEvalCaseDetailed({ evalCase, run, judge });
    if (score.status === 'FAIL') {
      await enqueueEvalFailure({ evalCase, run, reason: score.reason });
    }
    return jsonResponse({
      score,
      run,
      case: evalCase,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
