import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { listSkills } from '@/lib/registry/skills';
import { createSkill, skillCreatePayloadSchema } from '@/lib/registry/skill-create';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const enabledParam = searchParams.get('enabled');
    const skills = await listSkills();
    const enabled = skills.filter((skill) => skill.enabled);
    const filtered =
      enabledParam === 'true'
        ? enabled
        : enabledParam === 'false'
          ? skills.filter((skill) => !skill.enabled)
          : skills;

    return jsonResponse({
      skills: filtered,
      total: filtered.length,
      enabled: enabled.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, skillCreatePayloadSchema);
    const skill = await createSkill(payload);
    return jsonResponse({ skill }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
