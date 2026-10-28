import { errorResponse } from '@/lib/api';
import {
  exportAnnotationsCsv,
  exportAnnotationsJsonl,
} from '@/lib/ops/annotations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format');
    const filters = {
      status: searchParams.get('status') ?? undefined,
      target: searchParams.get('target') ?? undefined,
      origin: searchParams.get('origin') ?? undefined,
      runId: searchParams.get('runId') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
    };
    if (format === 'jsonl') {
      const scope = searchParams.get('scope') === 'review' ? 'review' : 'all';
      const { jsonl } = await exportAnnotationsJsonl(filters, scope);
      return new Response(jsonl, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Content-Disposition': `attachment; filename="snackops-annotations-${scope}.jsonl"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    const { csv } = await exportAnnotationsCsv(filters);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="snackops-annotations.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
