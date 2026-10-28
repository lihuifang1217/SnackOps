import { z } from 'zod';
import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import {
  getSkillTestPanel,
  runSkillTest,
} from '@/lib/registry/skill-tests';
import { providerSelectionSchema } from '@/lib/agent/request-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

const runSkillTestSchema = z
  .object({
    sampleInput: z.string().trim().min(1, '测试样本不能为空').max(6000),
    provider: providerSelectionSchema.optional(),
  })
  .strict();

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return jsonResponse(await getSkillTestPanel(id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const payload = await parseJsonBody(request, runSkillTestSchema);
    const result = await runSkillTest({
      skillId: id,
      sampleInput: payload.sampleInput,
      provider: payload.provider,
    });
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
