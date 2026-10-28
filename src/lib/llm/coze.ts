import 'server-only';

import { Config, LLMClient } from 'coze-coding-dev-sdk';
import { AppError } from '@/lib/errors';
import type { ProviderSelectionInfo } from '@/lib/types';
import type { LlmClient, LlmGenerateRequest, LlmGeneration } from './types';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppError(
          504,
          'LLM_TIMEOUT',
          `Coze 模型在 ${timeoutMs}ms 内没有响应，请稍后重试。`,
          { provider: 'coze' },
        ),
      );
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export function createCozeClient(
  info: ProviderSelectionInfo,
  timeoutMs: number,
): LlmClient {
  let client: LLMClient;
  try {
    const config = new Config({
      apiKey:
        process.env.COZE_API_TOKEN ||
        process.env.COZE_WORKLOAD_IDENTITY_API_KEY ||
        process.env.COZE_CODING_API_KEY,
      baseUrl: process.env.COZE_INTEGRATION_BASE_URL || process.env.COZE_CODING_BASE_URL,
      modelBaseUrl:
        process.env.COZE_INTEGRATION_MODEL_BASE_URL ||
        process.env.COZE_CODING_MODEL_BASE_URL,
      timeout: timeoutMs,
    });
    config.validate();
    client = new LLMClient(config);
  } catch {
    throw new AppError(
      503,
      'LLM_CONFIG_MISSING',
      'Coze 凭据未配置或无效。请设置 COZE_API_TOKEN 或 COZE_WORKLOAD_IDENTITY_API_KEY；如需课堂演示，请在请求中选择 classroom-fixture。',
      { provider: 'coze' },
    );
  }

  return {
    info,
    async generate(request: LlmGenerateRequest): Promise<LlmGeneration> {
      const model = request.model || info.model;
      try {
        const response = await withTimeout(
          client.invoke(
            request.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            {
              model,
              temperature: request.temperature,
              thinking: 'disabled',
              caching: 'disabled',
              streaming: false,
            },
          ),
          timeoutMs,
        );

        const text = response.content?.trim() ?? '';
        if (!text) {
          throw new AppError(
            502,
            'LLM_EMPTY_RESPONSE',
            'Coze 模型返回了空内容，本次运行不会伪装成功。',
            { provider: 'coze' },
          );
        }

        return {
          text,
          provider: 'coze',
          model,
          isDemo: false,
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          502,
          'LLM_UPSTREAM_ERROR',
          'Coze 模型调用失败，请检查凭据、模型名和网络。本次运行不会自动降级为课堂演示。',
          { provider: 'coze' },
        );
      }
    },
  };
}
