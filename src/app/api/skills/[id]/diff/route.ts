import { errorResponse, jsonResponse } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { diffSkillVersion } from '@/lib/registry/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to') ?? 'current';
    if (!from) {
      throw new AppError(400, 'DIFF_FROM_REQUIRED', '请通过 from 指定源版本 ID');
    }
    return jsonResponse(await diffSkillVersion(id, from, to));
  } catch (error) {
    return errorResponse(error);
  }
}
