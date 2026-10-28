import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { batchRunSchema, createBatch } from '@/lib/eval/batch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, batchRunSchema);
    const batch = await createBatch(payload);
    return jsonResponse({ batchId: batch.id, batch }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
