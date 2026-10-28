import { errorResponse } from '@/lib/api';
import { parseJsonBody } from '@/lib/api';
import { agentRunRequestSchema } from '@/lib/agent/request-schemas';
import { prepareAgentRun, runPreparedAgent } from '@/lib/agent/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const payload = await parseJsonBody(request, agentRunRequestSchema);
    const prepared = await prepareAgentRun({
      request: payload,
      source: payload.source ?? 'api',
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // 客户端断开后继续完成服务端运行和持久化。
          }
        };

        send({ type: 'run', run: prepared.run });

        try {
          const finalRun = await runPreparedAgent(prepared, send);
          send({ type: 'done', run: finalRun });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Agent 执行失败';
          send({ type: 'error', error: message, code: 'AGENT_STREAM_ERROR' });
          send({ type: 'done', run: prepared.run });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
