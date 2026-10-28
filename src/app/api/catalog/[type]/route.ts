import { errorResponse, jsonResponse, readRequestBody } from '@/lib/api';
import { getCatalogRecords } from '@/lib/catalog';
import { createCatalogRecord } from '@/lib/catalog-crud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ type: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { type } = await context.params;
    return jsonResponse(await getCatalogRecords(type));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { type } = await context.params;
    const body = await readRequestBody(request);
    const record = await createCatalogRecord(type, body);
    return jsonResponse({ ok: true, record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
