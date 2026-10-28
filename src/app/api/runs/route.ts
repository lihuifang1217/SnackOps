import { errorResponse, jsonResponse } from '@/lib/api';
import { listRuns } from '@/lib/agent/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPage = Number(searchParams.get('page') ?? '1');
    const rawLimit = Number(searchParams.get('limit') ?? '20');
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;
    return jsonResponse(await listRuns({ page, limit }));
  } catch (error) {
    return errorResponse(error);
  }
}
