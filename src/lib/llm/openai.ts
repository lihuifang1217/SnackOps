import 'server-only';

import { AppError } from '@/lib/errors';
import type { ProviderSelectionInfo } from '@/lib/types';
import type { LlmClient, LlmGenerateRequest, LlmGeneration } from './types';

type OpenAiResponse = {
  model?: string;
  choices?: {
    message?: {
      content?: string | { type?: string; text?: string }[];
    };
  }[];
  error?: {
    message?: string;
    type?: string;
  };
};

function contentFrom(response: OpenAiResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part.text ?? ''))
      .join('')
      .trim();
  }
  return '';
}

export function createOpenAiClient(
  info: ProviderSelectionInfo,
  timeoutMs: number,
): LlmClient {
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const baseUrl = process.env.OPENAI_BASE_URL!.trim().replace(/\/+$/, '');

  return {
    info,
    async generate(request: LlmGenerateRequest): Promise<LlmGeneration> {
      const model = request.model || info.model;
      const body = {
        model,
        messages: request.messages,
        temperature: request.temperature,
        ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
        ...(request.json ? { response_format: { type: 'json_object' } } : {}),
        stream: false,
      };

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
        throw new AppError(
          isTimeout ? 504 : 502,
          isTimeout ? 'LLM_TIMEOUT' : 'LLM_UPSTREAM_ERROR',
          isTimeout
            ? `OpenAI 兼容模型在 ${timeoutMs}ms 内没有响应，请稍后重试。`
            : '无法连接 OpenAI 兼容模型服务，请检查 OPENAI_BASE_URL 与网络。',
          { provider: 'openai-compatible' },
        );
      }

      let payload: OpenAiResponse | null = null;
      try {
        payload = (await response.json()) as OpenAiResponse;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new AppError(
          502,
          'LLM_UPSTREAM_ERROR',
          `OpenAI 兼容模型返回 HTTP ${response.status}${payload?.error?.message ? `：${payload.error.message.slice(0, 180)}` : ''}。`,
          { provider: 'openai-compatible', status: response.status },
        );
      }

      const text = contentFrom(payload ?? {});
      if (!text) {
        throw new AppError(
          502,
          'LLM_EMPTY_RESPONSE',
          'OpenAI 兼容模型返回了空内容，本次运行不会伪装成功。',
          { provider: 'openai-compatible' },
        );
      }

      return {
        text,
        provider: 'openai-compatible',
        model: payload?.model || model,
        isDemo: false,
      };
    },
  };
}
