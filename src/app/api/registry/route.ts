import { errorResponse, jsonResponse } from '@/lib/api';
import { getEnabledCapabilities } from '@/lib/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return jsonResponse(await getEnabledCapabilities());
  } catch (error) {
    return errorResponse(error);
  }
}
