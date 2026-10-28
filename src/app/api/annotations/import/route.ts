import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import { annotationImportSchema, importBadCases } from '@/lib/ops/annotations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, annotationImportSchema);
    return jsonResponse(await importBadCases(payload), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
