import { getHealthSnapshot } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await getHealthSnapshot();
    return Response.json(snapshot, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[health] JSON 存储检查失败', error);
    return Response.json(
      { status: 'error', storage: 'unavailable', error: 'JSON 存储检查失败' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
