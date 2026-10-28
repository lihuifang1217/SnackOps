import { errorResponse, jsonResponse } from '@/lib/api';
import { listSkillVersions } from '@/lib/registry/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return jsonResponse({ versions: await listSkillVersions(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
