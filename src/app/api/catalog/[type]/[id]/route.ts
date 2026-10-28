import { errorResponse, jsonResponse, readRequestBody } from '@/lib/api';
import {
  deleteCatalogRecord,
  updateCatalogRecord,
} from '@/lib/catalog-crud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ type: string; id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const { type, id } = await context.params;
    const body = await readRequestBody(request);
    const record = await updateCatalogRecord(type, id, body);
    return jsonResponse({ ok: true, record });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { type, id } = await context.params;
    const record = await deleteCatalogRecord(type, id);
    return jsonResponse({ ok: true, record });
  } catch (error) {
    return errorResponse(error);
  }
}
