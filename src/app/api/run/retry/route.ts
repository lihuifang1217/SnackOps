import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { retryRunRequestSchema } from '@/lib/agent/request-schemas';
import { retryRun } from '@/lib/agent/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, retryRunRequestSchema);
    const run = await retryRun(payload);
    return jsonResponse({ run });
  } catch (error) {
    return errorResponse(error);
  }
}
