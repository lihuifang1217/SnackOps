import { errorResponse, jsonResponse } from '@/lib/api';
import { getOpsOverview } from '@/lib/ops/overview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return jsonResponse(await getOpsOverview());
  } catch (error) {
    return errorResponse(error);
  }
}
