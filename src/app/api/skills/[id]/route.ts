import { z } from 'zod';
import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import {
  getSkillDetail,
  saveSkillVersion,
  setSkillEnabled,
  skillUpdatePayloadSchema,
} from '@/lib/registry/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const toggleSchema = z.object({ enabled: z.boolean() }).strict();

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return jsonResponse({ skill: await getSkillDetail(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, skillUpdatePayloadSchema);
    const skill = await saveSkillVersion(id, payload);
    return jsonResponse({ skill });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, toggleSchema);
    const skill = await setSkillEnabled(id, payload.enabled);
    return jsonResponse({ skill });
  } catch (error) {
    return errorResponse(error);
  }
}
