import { errorResponse, jsonResponse } from '@/lib/api';
import { getCatalogOverview } from '@/lib/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return jsonResponse(await getCatalogOverview());
  } catch (error) {
    return errorResponse(error);
  }
}
