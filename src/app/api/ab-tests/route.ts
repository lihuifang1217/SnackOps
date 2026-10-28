import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { abTestCreateSchema, createAbTest, listAbTests } from '@/lib/ops/ab-tests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const abTests = await listAbTests();
    return jsonResponse({ abTests, total: abTests.length });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, abTestCreateSchema);
    return jsonResponse({ abTest: await createAbTest(payload) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
