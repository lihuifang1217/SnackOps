import { errorResponse, jsonResponse } from '@/lib/api';
import { readCollection } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const tickets = await readCollection('tickets');
    return jsonResponse({
      tickets: [...tickets].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      total: tickets.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
