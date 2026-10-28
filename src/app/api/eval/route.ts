import { errorResponse, jsonResponse } from '@/lib/api';
import { readCollection } from '@/lib/store';
import { listEvalCases } from '@/lib/eval/cases';
import { getEvalConfig } from '@/lib/eval/config';
import { listSkills } from '@/lib/registry/skills';
import { listTools } from '@/lib/registry/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [cases, batches, skills, tools, config] = await Promise.all([
      listEvalCases(),
      readCollection('eval_batches'),
      listSkills(),
      listTools(),
      getEvalConfig(),
    ]);
    return jsonResponse({
      cases,
      batches,
      skills,
      tools,
      config,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
