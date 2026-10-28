import 'server-only';

import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { readCollection, writeCollection } from '@/lib/store';
import type { CollectionData } from '@/lib/schemas';
import type { ToolSummary, ToolTestResponse } from '@/lib/types';
import {
  isToolId,
  toolDefinitions,
  type ToolId,
} from '@/tools/definitions';
import { toolHandlers } from '@/tools/implementations';
import { withRegistryLock } from './lock';

type ToolRow = CollectionData<'tools'>[number];
type ToolsConfig = CollectionData<'tools-config'>;

const TOOL_TIMEOUT_LIMIT_MS = 60_000;

export const toolUpdatePayloadSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1, '工具名称不能为空').max(80).optional(),
    description: z.string().trim().min(1, '能力描述不能为空').max(500).optional(),
  })
  .strict()
  .refine(
    (value) => value.enabled !== undefined || value.name !== undefined || value.description !== undefined,
    { message: '至少需要提交一个可更新字段' },
  );

function findDefinition(toolId: string) {
  if (!isToolId(toolId)) {
    throw new AppError(404, 'TOOL_NOT_FOUND', '工具定义不存在');
  }
  return toolDefinitions[toolId];
}

function effectiveEnabled(tool: ToolRow, config: ToolsConfig): boolean {
  return tool.enabled && (config.tools[tool.id]?.enabled ?? tool.enabled);
}

function toSummary(tool: ToolRow, config: ToolsConfig): ToolSummary {
  const definition = findDefinition(tool.id);
  const enabled = effectiveEnabled(tool, config);
  const inputSchema = z.toJSONSchema(definition.inputSchema) as Record<string, unknown>;
  const outputSchema = z.toJSONSchema(definition.outputSchema) as Record<string, unknown>;
  const toolConfig = config.tools[tool.id] ?? { enabled: tool.enabled, retry: 0 };

  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    enabled,
    version: tool.version,
    timeoutMs: tool.timeoutMs,
    executionMode: definition.executionMode,
    implementationPath: definition.implementationPath,
    dataSources: definition.dataSources,
    readOnly: true,
    inputSchema,
    outputSchema,
    outputExample: definition.outputExample,
    sampleInput: definition.sampleInput,
    fullConfig: {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      enabled,
      version: tool.version,
      timeoutMs: tool.timeoutMs,
      updatedAt: tool.updatedAt,
      config: {
        enabled: toolConfig.enabled,
        retry: toolConfig.retry,
      },
      runtime: {
        mode: config.mode,
        defaultTimeoutMs: config.defaultTimeoutMs,
        allowMutations: config.allowMutations,
      },
      execution: {
        mode: definition.executionMode,
        implementationPath: definition.implementationPath,
        dataSources: definition.dataSources,
        readOnly: true,
      },
      inputSchema,
      outputSchema,
      outputExample: definition.outputExample,
      sampleInput: definition.sampleInput,
    },
  };
}

export async function listTools(): Promise<ToolSummary[]> {
  const [tools, config] = await Promise.all([
    readCollection('tools'),
    readCollection('tools-config'),
  ]);
  return tools.map((tool) => toSummary(tool, config));
}

export async function listEnabledTools(): Promise<ToolSummary[]> {
  const tools = await listTools();
  return tools.filter((tool) => tool.enabled);
}

export async function getTool(toolId: string): Promise<ToolSummary> {
  if (!isToolId(toolId)) {
    throw new AppError(404, 'TOOL_NOT_FOUND', '工具不存在');
  }
  const [tools, config] = await Promise.all([
    readCollection('tools'),
    readCollection('tools-config'),
  ]);
  const tool = tools.find((item) => item.id === toolId);
  if (!tool) {
    throw new AppError(404, 'TOOL_NOT_FOUND', '工具不存在');
  }
  return toSummary(tool, config);
}

export async function updateTool(
  toolId: string,
  patch: z.infer<typeof toolUpdatePayloadSchema>,
): Promise<ToolSummary> {
  if (!isToolId(toolId)) {
    throw new AppError(404, 'TOOL_NOT_FOUND', '工具不存在');
  }

  return withRegistryLock('tools-registry', async () => {
    const [tools, config] = await Promise.all([
      readCollection('tools'),
      readCollection('tools-config'),
    ]);
    const current = tools.find((item) => item.id === toolId);
    if (!current) {
      throw new AppError(404, 'TOOL_NOT_FOUND', '工具不存在');
    }

    const enabled = patch.enabled ?? current.enabled;
    const nextTool: ToolRow = {
      ...current,
      enabled,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      updatedAt: new Date().toISOString(),
    };
    const nextTools = tools.map((tool) => (tool.id === toolId ? nextTool : tool));
    const nextConfig: ToolsConfig = {
      ...config,
      tools: {
        ...config.tools,
        [toolId]: {
          enabled,
          retry: config.tools[toolId]?.retry ?? 0,
        },
      },
    };

    await writeCollection('tools', nextTools);
    try {
      await writeCollection('tools-config', nextConfig);
    } catch (error) {
      await writeCollection('tools', tools).catch(() => undefined);
      throw error;
    }

    return toSummary(nextTool, nextConfig);
  });
}

export async function setToolEnabled(toolId: string, enabled: boolean): Promise<ToolSummary> {
  return updateTool(toolId, { enabled });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError(504, 'TOOL_TIMEOUT', `${toolId} 执行超过 ${timeoutMs}ms`));
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

export async function executeTool(toolId: string, input: unknown): Promise<ToolTestResponse> {
  if (!isToolId(toolId)) {
    throw new AppError(404, 'TOOL_NOT_FOUND', '工具不存在');
  }

  const [tools, config] = await Promise.all([
    readCollection('tools'),
    readCollection('tools-config'),
  ]);
  const tool = tools.find((item) => item.id === toolId);
  if (!tool) {
    throw new AppError(404, 'TOOL_NOT_FOUND', '工具不存在');
  }
  if (!effectiveEnabled(tool, config)) {
    throw new AppError(409, 'TOOL_DISABLED', '工具已停用，无法执行');
  }

  const definition = toolDefinitions[toolId];
  const parsedInput = definition.inputSchema.parse(input);
  const timeoutMs = Math.min(tool.timeoutMs || config.defaultTimeoutMs, TOOL_TIMEOUT_LIMIT_MS);
  const startedAt = performance.now();

  try {
    const output = await withTimeout(toolHandlers[toolId](parsedInput), timeoutMs, toolId);
    const validated = definition.outputSchema.safeParse(output);
    if (!validated.success) {
      console.error('[tools] 输出未通过 schema 校验', toolId, validated.error.issues);
      throw new AppError(500, 'TOOL_OUTPUT_INVALID', '工具输出未通过 schema 校验');
    }
    return {
      toolId,
      input: parsedInput,
      durationMs: Math.round(performance.now() - startedAt),
      output: validated.data,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('[tools] 执行失败', toolId, error);
    throw new AppError(500, 'TOOL_EXECUTION_FAILED', '工具执行失败');
  }
}

export type { ToolId };
