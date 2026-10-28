import 'server-only';

import { AppError } from '@/lib/errors';
import { readCollection } from '@/lib/store';
import type { AgentProviderId, AgentProviderSelection, ProviderSelectionInfo } from '@/lib/types';
import type { LlmClient } from './types';

const DEFAULT_TIMEOUT_MS = 20_000;
const COZE_DEFAULT_MODEL = 'doubao-seed-2-0-pro-260215';

function timeoutMs(): number {
  const parsed = Number(process.env.LLM_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(120_000, Math.max(1_000, Math.round(parsed)));
}

function normalizeProvider(value: string | undefined): AgentProviderId | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'fixture' || normalized === 'classroom-fixture') return 'classroom-fixture';
  if (normalized === 'openai' || normalized === 'openai-compatible') return 'openai-compatible';
  if (normalized === 'coze') return 'coze';
  return null;
}

export function getRequestedProviderId(
  selection: AgentProviderSelection | undefined,
): AgentProviderId | null {
  if (!selection || selection === 'auto') return null;
  return selection;
}

function autoProviderId(): { id: AgentProviderId; source: ProviderSelectionInfo['source']; model?: string } {
  const rawEnvProvider = process.env.LLM_PROVIDER?.trim();
  const envProvider = normalizeProvider(rawEnvProvider);
  if (rawEnvProvider && !envProvider) {
    throw new AppError(
      503,
      'INVALID_LLM_PROVIDER',
      `LLM_PROVIDER=${rawEnvProvider} 不是受支持的 Provider。请使用 openai-compatible、coze 或 classroom-fixture。`,
    );
  }
  if (envProvider) return { id: envProvider, source: 'environment' };

  if (
    process.env.OPENAI_API_KEY?.trim() &&
    process.env.OPENAI_BASE_URL?.trim() &&
    process.env.LLM_MODEL?.trim()
  ) {
    return { id: 'openai-compatible', source: 'environment' };
  }

  if (
    process.env.COZE_API_TOKEN?.trim() ||
    process.env.COZE_WORKLOAD_IDENTITY_API_KEY?.trim() ||
    process.env.COZE_CODING_API_KEY?.trim()
  ) {
    return { id: 'coze', source: 'environment' };
  }

  return { id: 'classroom-fixture', source: 'default-demo' };
}

function storedProviderId(value: 'fixture' | 'openai-compatible' | 'coze'): AgentProviderId {
  return value === 'fixture' ? 'classroom-fixture' : value;
}

async function managedProvider(): Promise<{
  id: AgentProviderId;
  source: ProviderSelectionInfo['source'];
  model?: string;
} | null> {
  const config = await readCollection('llm-config');
  if (!config.managed) return null;
  return {
    id: storedProviderId(config.provider),
    source: 'config',
    model: config.model,
  };
}

function fixtureInfo(source: ProviderSelectionInfo['source']): ProviderSelectionInfo {
  return {
    id: 'classroom-fixture',
    model: 'classroom-fixture-v1',
    isDemo: true,
    source,
    notice:
      '课堂演示模式：使用确定性生成器，不调用外部模型；仍会执行真实 Tool、风险检查和评分报告链路。',
  };
}

function openAiInfo(
  source: ProviderSelectionInfo['source'],
  model: string,
): ProviderSelectionInfo {
  return {
    id: 'openai-compatible',
    model,
    isDemo: false,
    source,
    notice: '真实模型模式：OpenAI 兼容接口失败时会返回结构化错误，不会自动降级为课堂演示。',
  };
}

function cozeInfo(
  source: ProviderSelectionInfo['source'],
  model: string,
): ProviderSelectionInfo {
  return {
    id: 'coze',
    model,
    isDemo: false,
    source,
    notice: '真实模型模式：Coze LLM 调用失败时会返回结构化错误，不会自动降级为课堂演示。',
  };
}

function assertOpenAiConfig(modelOverride?: string): void {
  const missing: string[] = [];
  if (!process.env.OPENAI_API_KEY?.trim()) missing.push('OPENAI_API_KEY');
  if (!process.env.OPENAI_BASE_URL?.trim()) missing.push('OPENAI_BASE_URL');
  if (!(modelOverride?.trim() || process.env.LLM_MODEL?.trim())) missing.push('LLM_MODEL');
  if (missing.length > 0) {
    throw new AppError(
      503,
      'LLM_CONFIG_MISSING',
      `已选择 OpenAI 兼容模式，但缺少 ${missing.join('、')}。请设置环境变量后再试；如需课堂演示，请在请求中选择 classroom-fixture 或设置 LLM_PROVIDER=classroom-fixture。`,
      { provider: 'openai-compatible', missing },
    );
  }
}

function assertCozeConfig(): void {
  const hasKey =
    process.env.COZE_API_TOKEN?.trim() ||
    process.env.COZE_WORKLOAD_IDENTITY_API_KEY?.trim() ||
    process.env.COZE_CODING_API_KEY?.trim();
  if (!hasKey) {
    throw new AppError(
      503,
      'LLM_CONFIG_MISSING',
      '已选择 Coze 模式，但缺少 COZE_API_TOKEN 或 COZE_WORKLOAD_IDENTITY_API_KEY。请配置 Coze 凭据；如需课堂演示，请在请求中选择 classroom-fixture 或设置 LLM_PROVIDER=classroom-fixture。',
      { provider: 'coze', missing: ['COZE_API_TOKEN'] },
    );
  }
}

export async function createLlmClient(
  selection: AgentProviderSelection | undefined,
  modelOverride?: string,
): Promise<LlmClient> {
  const requested = getRequestedProviderId(selection);
  const persisted = requested ? null : await managedProvider();
  const resolved = requested
    ? { id: requested, source: 'request' as const, model: modelOverride }
    : persisted ?? { ...autoProviderId(), model: modelOverride };
  const selectedModel = modelOverride?.trim() || resolved.model?.trim();

  if (resolved.id === 'classroom-fixture') {
    const { createFixtureClient } = await import('./fixture');
    return createFixtureClient(fixtureInfo(resolved.source));
  }

  if (resolved.id === 'openai-compatible') {
    assertOpenAiConfig(selectedModel);
    const { createOpenAiClient } = await import('./openai');
    return createOpenAiClient(
      openAiInfo(
        resolved.source,
        selectedModel || process.env.LLM_MODEL!.trim(),
      ),
      timeoutMs(),
    );
  }

  assertCozeConfig();
  const { createCozeClient } = await import('./coze');
  return createCozeClient(
    cozeInfo(
      resolved.source,
      selectedModel ||
        (process.env.LLM_MODEL || process.env.COZE_MODEL || COZE_DEFAULT_MODEL).trim(),
    ),
    timeoutMs(),
  );
}

export function providerNotice(info: ProviderSelectionInfo): string {
  return info.notice;
}
