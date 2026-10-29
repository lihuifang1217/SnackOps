import { z } from 'zod';
import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { applySkillVersion } from '@/lib/registry/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const applyVersionSchema = z
  .object({
    versionId: z.string().trim().min(1).max(160),
  })
  .strict();

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, applyVersionSchema);
    const skill = await applySkillVersion(id, payload.versionId);
    return jsonResponse({ skill, appliedVersionId: payload.versionId });
  } catch (error) {
    return errorResponse(error);
  }
}
