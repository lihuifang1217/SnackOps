import { z } from 'zod';
import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { rollbackSkillVersion } from '@/lib/registry/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const rollbackSchema = z
  .object({
    versionId: z.string().trim().min(1).max(160),
    changeNote: z.string().trim().max(500).optional(),
  })
  .strict();

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, rollbackSchema);
    const skill = await rollbackSkillVersion(id, payload.versionId, payload.changeNote);
    return jsonResponse({ skill, rolledBackTo: payload.versionId });
  } catch (error) {
    return errorResponse(error);
  }
}
