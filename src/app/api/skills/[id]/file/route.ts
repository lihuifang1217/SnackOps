import { errorResponse, jsonResponse } from '@/lib/api';
import { getSkillDetail } from '@/lib/registry/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const skill = await getSkillDetail(id);
    return jsonResponse({
      skillId: skill.id,
      filePath: skill.filePath,
      hash: skill.hash,
      content: skill.systemPrompt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
