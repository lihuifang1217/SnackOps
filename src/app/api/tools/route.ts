import { errorResponse, jsonResponse } from '@/lib/api';
import { listTools } from '@/lib/registry/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const tools = await listTools();
    return jsonResponse({
      tools,
      total: tools.length,
      enabled: tools.filter((tool) => tool.enabled).length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
