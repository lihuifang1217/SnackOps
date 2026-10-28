import type { AgentRunRequest, AgentStreamEvent, ApiErrorBody } from './types';

export class AgentStreamError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = 'AGENT_STREAM_ERROR') {
    super(message);
    this.name = 'AgentStreamError';
    this.status = status;
    this.code = code;
  }
}

async function readError(response: Response): Promise<AgentStreamError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await response.json()) as Partial<ApiErrorBody>;
  } catch {
    body = null;
  }
  return new AgentStreamError(
    body?.error ?? `Agent 请求失败（HTTP ${response.status}）`,
    response.status,
    body?.code ?? 'AGENT_STREAM_ERROR',
  );
}

export async function streamAgentRun(
  input: AgentRunRequest,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/agent/run', {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal,
    cache: 'no-store',
  });

  if (!response.ok) throw await readError(response);
  if (!response.body) {
    throw new AgentStreamError('浏览器未收到 Agent 流式响应', 0, 'EMPTY_STREAM');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processBlock = (block: string) => {
    const dataLines = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) return;
    const raw = dataLines.join('\n');
    try {
      onEvent(JSON.parse(raw) as AgentStreamEvent);
    } catch {
      // 忽略无法解析的调试事件，不中断后续流。
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (block.trim()) processBlock(block);
      boundary = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) processBlock(buffer);
}
