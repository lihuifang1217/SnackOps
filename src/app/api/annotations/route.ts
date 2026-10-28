import { errorResponse, jsonResponse, parseJsonBody } from '@/lib/api';
import {
  annotationCreateSchema,
  createAnnotation,
  listAnnotations,
} from '@/lib/ops/annotations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function filtersFrom(request: Request) {
  const { searchParams } = new URL(request.url);
  return {
    status: searchParams.get('status') ?? undefined,
    target: searchParams.get('target') ?? undefined,
    origin: searchParams.get('origin') ?? undefined,
    runId: searchParams.get('runId') ?? undefined,
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  };
}

export async function GET(request: Request) {
  try {
    const annotations = await listAnnotations(filtersFrom(request));
    return jsonResponse({ annotations, total: annotations.length });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, annotationCreateSchema);
    const annotation = await createAnnotation(payload);
    return jsonResponse({ annotation }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
