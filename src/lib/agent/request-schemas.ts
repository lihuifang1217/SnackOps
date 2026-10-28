import { z } from 'zod';

export const providerSelectionSchema = z.enum([
  'auto',
  'classroom-fixture',
  'openai-compatible',
  'coze',
]);

export const conversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(6000),
});

export const agentRunRequestSchema = z
  .object({
    userInput: z.string().trim().min(1, '请输入问题').max(6000),
    conversationHistory: z.array(conversationMessageSchema).max(20).optional(),
    conversationId: z.string().trim().min(1).max(120).optional(),
    source: z.enum(['workbench', 'demo', 'api']).optional(),
    provider: providerSelectionSchema.optional(),
    mandatoryCapabilities: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  })
  .strict();

export const plannerPreviewRequestSchema = z
  .object({
    userInput: z.string().trim().min(1, '请输入测试问题').max(6000),
    conversationHistory: z.array(conversationMessageSchema).max(20).optional(),
    mandatoryCapabilities: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    skillIds: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
    toolIds: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    provider: providerSelectionSchema.optional(),
  })
  .strict();

export const retryRunRequestSchema = z
  .object({
    runId: z.string().trim().min(1),
    provider: providerSelectionSchema.optional(),
  })
  .strict();

export const handoffRequestSchema = z
  .object({
    reason: z.string().trim().min(1, '请填写接管原因').max(500),
    by: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const annotateRequestSchema = z
  .object({
    label: z.string().trim().min(1, '请填写标注标签').max(80),
    note: z.string().trim().max(2000).default(''),
    annotator: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const explainRequestSchema = z
  .object({
    runId: z.string().trim().min(1),
  })
  .strict();
