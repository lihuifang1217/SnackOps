import 'server-only';

import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { readCollection, updateCollection } from '@/lib/store';
import type { LlmConfig } from '@/lib/schemas';
import type {
  AgentProviderId,
  LlmConfigView,
  LlmCurrentView,
  LlmEnvStatus,
  LlmProviderView,
  LlmTestResponse,
  ProviderSelectionInfo,
} from '@/lib/types';
import { createLlmClient } from './config';
import { detectInputSignals } from '@/lib/agent/signals';

const COZE_DEFAULT_MODEL = 'doubao-seed-2-0-pro-260215';
const FIXTURE_MODEL = 'classroom-fixture-v1';

export const llmSwitchSchema = z
  .object({
    provider: z.enum(['classroom-fixture', 'openai-compatible', 'coze']),
    model: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const llmConfigUpdateSchema = z
  .object({
    provider: z.enum(['classroom-fixture', 'openai-compatible', 'coze']).optional(),
    model: z.string().trim().min(1).max(160).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(32000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.provider !== undefined ||
      value.model !== undefined ||
      value.temperature !== undefined ||
      value.maxTokens !== undefined,
    { message: '至少需要一个配置字段' },
  );

export const llmTestSchema = z
  .object({
    provider: z.enum(['classroom-fixture', 'openai-compatible', 'coze']).optional(),
    model: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

type StoredProvider = LlmConfig['provider'];

function mapStored(value: StoredProvider): AgentProviderId {
  return value === 'fixture' ? 'classroom-fixture' : value;
}

function stored(value: AgentProviderId): StoredProvider {
  return value === 'classroom-fixture' ? 'fixture' : value;
}

function envStatuses(provider: AgentProviderId): LlmEnvStatus[] {
  if (provider === 'openai-compatible') {
    return [
      {
        key: 'OPENAI_API_KEY',
        label: 'API 密钥',
        required: true,
        configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      },
      {
        key: 'OPENAI_BASE_URL',
        label: '接口地址',
        required: true,
        configured: Boolean(process.env.OPENAI_BASE_URL?.trim()),
      },
      {
        key: 'LLM_MODEL',
        label: '环境变量默认模型',
        required: false,
        configured: Boolean(process.env.LLM_MODEL?.trim()),
      },
    ];
  }
  if (provider === 'coze') {
    return [
      {
        key: 'COZE_API_TOKEN | COZE_WORKLOAD_IDENTITY_API_KEY',
        label: 'Coze 凭据',
        required: true,
        configured: Boolean(
          process.env.COZE_API_TOKEN?.trim() ||
            process.env.COZE_WORKLOAD_IDENTITY_API_KEY?.trim() ||
            process.env.COZE_CODING_API_KEY?.trim(),
        ),
      },
      {
        key: 'COZE_INTEGRATION_BASE_URL',
        label: 'Coze API 地址',
        required: false,
        configured: Boolean(
          process.env.COZE_INTEGRATION_BASE_URL?.trim() ||
            process.env.COZE_CODING_BASE_URL?.trim(),
        ),
      },
      {
        key: 'COZE_INTEGRATION_MODEL_BASE_URL',
        label: 'Coze 模型地址',
        required: false,
        configured: Boolean(
          process.env.COZE_INTEGRATION_MODEL_BASE_URL?.trim() ||
            process.env.COZE_CODING_MODEL_BASE_URL?.trim(),
        ),
      },
    ];
  }
  return [];
}

function providerLabel(provider: AgentProviderId): string {
  if (provider === 'classroom-fixture') return '课堂演示（稳定）';
  if (provider === 'openai-compatible') return 'OpenAI 兼容';
  return 'Coze LLM';
}

function providerDescription(provider: AgentProviderId): string {
  if (provider === 'classroom-fixture') {
    return '确定性生成器，不调用外部模型。用于课堂演示、离线验收和稳定回归；仍会执行真实 Tool 与风险审核。';
  }
  if (provider === 'openai-compatible') {
    return '通过 OPENAI_BASE_URL 调用 OpenAI 兼容 chat/completions 接口；失败或超时会返回结构化错误，不会自动降级。';
  }
  return '通过 coze-coding-dev-sdk 调用 Coze LLM；缺少凭据时明确失败，不会自动切换演示模式。';
}

function defaultModel(
  provider: AgentProviderId,
  config: LlmConfig,
): string {
  if (provider === 'classroom-fixture') return FIXTURE_MODEL;
  if (config.provider === stored(provider) && config.model.trim()) return config.model.trim();
  if (provider === 'openai-compatible') {
    return process.env.LLM_MODEL?.trim() || 'gpt-4o-mini';
  }
  return (
    process.env.LLM_MODEL?.trim() ||
    process.env.COZE_MODEL?.trim() ||
    COZE_DEFAULT_MODEL
  );
}

function modelList(provider: AgentProviderId, config: LlmConfig): string[] {
  const fallback = defaultModel(provider, config);
  const envModel = process.env.LLM_MODEL?.trim();
  const candidates =
    provider === 'classroom-fixture'
      ? [FIXTURE_MODEL]
      : provider === 'openai-compatible'
        ? [fallback, envModel, 'gpt-4o-mini', 'gpt-4.1-mini', 'deepseek-chat']
        : [
            fallback,
            envModel,
            process.env.COZE_MODEL?.trim(),
            'doubao-seed-2-0-pro-260215',
            'doubao-seed-1-6',
          ];
  return [...new Set(candidates.filter((item): item is string => Boolean(item)))];
}

function missingFor(provider: AgentProviderId): string[] {
  if (provider === 'classroom-fixture') return [];
  if (provider === 'openai-compatible') {
    const missing: string[] = [];
    if (!process.env.OPENAI_API_KEY?.trim()) missing.push('OPENAI_API_KEY');
    if (!process.env.OPENAI_BASE_URL?.trim()) missing.push('OPENAI_BASE_URL');
    return missing;
  }
  if (
    !process.env.COZE_API_TOKEN?.trim() &&
    !process.env.COZE_WORKLOAD_IDENTITY_API_KEY?.trim() &&
    !process.env.COZE_CODING_API_KEY?.trim()
  ) {
    return ['COZE_API_TOKEN'];
  }
  return [];
}

function providerView(
  provider: AgentProviderId,
  config: LlmConfig,
): LlmProviderView {
  const env = envStatuses(provider);
  const missing = missingFor(provider);
  return {
    id: provider,
    label: providerLabel(provider),
    description: providerDescription(provider),
    defaultModel: defaultModel(provider, config),
    models: modelList(provider, config),
    isDemo: provider === 'classroom-fixture',
    configured: missing.length === 0,
    missing,
    env,
  };
}

function currentView(config: LlmConfig): LlmCurrentView {
  let provider: AgentProviderId;
  let model: string;
  let source: ProviderSelectionInfo['source'];
  let invalidEnvProvider: string | null = null;

  if (config.managed) {
    provider = mapStored(config.provider);
    model = config.model.trim();
    source = 'config';
  } else {
    const rawEnvProvider = process.env.LLM_PROVIDER?.trim();
    const normalized = rawEnvProvider?.toLowerCase();
    if (rawEnvProvider) {
      if (normalized === 'fixture' || normalized === 'classroom-fixture') {
        provider = 'classroom-fixture';
      } else if (normalized === 'openai' || normalized === 'openai-compatible') {
        provider = 'openai-compatible';
      } else if (normalized === 'coze') {
        provider = 'coze';
      } else {
        provider = 'classroom-fixture';
        invalidEnvProvider = rawEnvProvider;
      }
    } else if (
      process.env.OPENAI_API_KEY?.trim() &&
      process.env.OPENAI_BASE_URL?.trim() &&
      process.env.LLM_MODEL?.trim()
    ) {
      provider = 'openai-compatible';
    } else if (
      process.env.COZE_API_TOKEN?.trim() ||
      process.env.COZE_WORKLOAD_IDENTITY_API_KEY?.trim() ||
      process.env.COZE_CODING_API_KEY?.trim()
    ) {
      provider = 'coze';
    } else {
      provider = 'classroom-fixture';
    }
    source = rawEnvProvider || provider !== 'classroom-fixture' ? 'environment' : 'default-demo';
    model = defaultModel(provider, config);
  }

  const missing = missingFor(provider);
  const error =
    invalidEnvProvider
      ? `LLM_PROVIDER=${invalidEnvProvider} 不是受支持的 Provider，后续运行会返回结构化错误。`
      : missing.length > 0
        ? `缺少环境变量：${missing.join('、')}。后续 Run 会返回 LLM_CONFIG_MISSING。`
        : null;

  return {
    provider,
    model,
    source,
    isDemo: provider === 'classroom-fixture',
    configured: missing.length === 0,
    missing,
    notice: providerDescription(provider),
    error,
  };
}

export async function getLlmConfigView(): Promise<LlmConfigView> {
  const config = await readCollection('llm-config');
  const current = currentView(config);
  const providers = (
    ['classroom-fixture', 'openai-compatible', 'coze'] as AgentProviderId[]
  ).map((provider) => providerView(provider, config));
  const mode: LlmConfigView['mode'] = current.error
    ? 'error'
    : current.isDemo
      ? 'demo'
      : 'real';
  const banner =
    mode === 'error'
      ? `运行模式异常：${current.error}`
      : mode === 'demo'
        ? '课堂演示稳定模式：确定性生成，不调用外部模型，但仍执行真实 Tool、Skill 版本和风险审核。'
        : `真实模型模式：${current.provider} / ${current.model}。调用失败不会自动降级。`;

  return {
    config,
    current,
    providers,
    mode,
    banner,
    generatedAt: new Date().toISOString(),
  };
}

function validatedModel(
  provider: AgentProviderId,
  requested: string | undefined,
  config: LlmConfig,
): string {
  if (provider === 'classroom-fixture') return FIXTURE_MODEL;
  return (requested?.trim() || defaultModel(provider, config)).trim();
}

export async function switchProvider(raw: unknown): Promise<LlmConfigView> {
  const input = llmSwitchSchema.parse(raw);
  const config = await readCollection('llm-config');
  const missing = missingFor(input.provider);
  if (missing.length > 0) {
    throw new AppError(
      503,
      'LLM_CONFIG_MISSING',
      `无法切换到${providerLabel(input.provider)}：缺少 ${missing.join('、')}。请配置环境变量并重启服务后再试。`,
      { provider: input.provider, missing },
    );
  }
  const model = validatedModel(input.provider, input.model, config);
  await updateCollection('llm-config', (current) => ({
    ...current,
    provider: stored(input.provider),
    model,
    configured: true,
    managed: true,
    updatedAt: new Date().toISOString(),
  }));
  return getLlmConfigView();
}

export async function updateLlmConfig(raw: unknown): Promise<LlmConfigView> {
  const input = llmConfigUpdateSchema.parse(raw);
  const config = await readCollection('llm-config');
  const current = currentView(config);
  const provider = input.provider ?? current.provider;
  const missing = missingFor(provider);
  if (missing.length > 0) {
    throw new AppError(
      503,
      'LLM_CONFIG_MISSING',
      `无法保存${providerLabel(provider)}配置：缺少 ${missing.join('、')}。`,
      { provider, missing },
    );
  }
  const model = validatedModel(provider, input.model, config);
  await updateCollection('llm-config', (value) => ({
    ...value,
    provider: stored(provider),
    model,
    temperature: input.temperature ?? value.temperature,
    maxTokens: input.maxTokens ?? value.maxTokens,
    configured: true,
    managed: true,
    updatedAt: new Date().toISOString(),
  }));
  return getLlmConfigView();
}

export async function testLlmConnection(raw: unknown): Promise<LlmTestResponse> {
  const input = llmTestSchema.parse(raw);
  const config = await readCollection('llm-config');
  const current = currentView(config);
  const provider = input.provider ?? current.provider;
  const model = validatedModel(provider, input.model, config);
  const client = await createLlmClient(provider, model);
  const startedAt = Date.now();
  const generation = await client.generate({
    messages: [
      { role: 'system', content: '你是 SnackOps 连接测试。只回复 OK。' },
      { role: 'user', content: '连接测试' },
    ],
    temperature: 0,
    maxTokens: 32,
    purpose: 'planner',
    fixture: {
      task: 'planner',
      userInput: '连接测试',
      conversationHistory: [],
      mandatoryCapabilities: [],
      signals: detectInputSignals(''),
      availableSkills: [],
      availableTools: [],
    },
  });
  return {
    ok: true,
    provider: generation.provider,
    model: generation.model,
    isDemo: generation.isDemo,
    durationMs: Date.now() - startedAt,
    message: generation.isDemo
      ? '课堂 fixture 本地执行正常；未调用外部模型。'
      : 'Provider 连接成功。',
  };
}
