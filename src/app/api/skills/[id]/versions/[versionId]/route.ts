import { errorResponse, jsonResponse } from '@/lib/api';
import { getSkillVersion } from '@/lib/registry/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; versionId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id, versionId } = await context.params;
    return jsonResponse({ version: await getSkillVersion(id, versionId) });
  } catch (error) {
    return errorResponse(error);
  }
}
