import { errorResponse, jsonResponse } from '@/lib/api';
import { getImprovementCenter } from '@/lib/ops/improvements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return jsonResponse(await getImprovementCenter());
  } catch (error) {
    return errorResponse(error);
  }
}
