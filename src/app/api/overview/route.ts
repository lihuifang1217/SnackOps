import { errorResponse, jsonResponse } from '@/lib/api';
import { getDashboardSnapshot, getHealthSnapshot } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [dashboard, health] = await Promise.all([
      getDashboardSnapshot(),
      getHealthSnapshot(),
    ]);
    return jsonResponse({
      dashboard,
      health,
      source: 'data/*.json',
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
