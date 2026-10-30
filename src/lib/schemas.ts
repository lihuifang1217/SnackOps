import { z } from 'zod';

const idSchema = z.string().min(1);
const isoDateSchema = z.string().min(1);

export const productSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  flavor: z.string().min(1),
  price: z.number().nonnegative(),
  stock: z.number().int().nonnegative(),
  status: z.enum(['在售', '预售', '下架']),
  tags: z.array(z.string()),
  ingredients: z.array(z.string()),
  allergens: z.array(z.string()),
  mayContain: z.array(z.string()),
  nutrition: z.object({
    basis: z.literal('每100g'),
    energyKcal: z.number().nonnegative(),
    proteinG: z.number().nonnegative(),
    fatG: z.number().nonnegative(),
    carbohydrateG: z.number().nonnegative(),
    sugarG: z.number().nonnegative(),
    sodiumMg: z.number().nonnegative(),
  }),
  shelfLifeDays: z.number().int().positive(),
});

export const activitySchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  type: z.enum(['满减', '折扣', '赠品']),
  status: z.enum(['进行中', '已结束', '草稿']),
  startAt: isoDateSchema,
  endAt: isoDateSchema,
  threshold: z.number().nonnegative(),
  discount: z.number().nonnegative(),
  offerRule: z.string().min(1),
  applicableProductIds: z.array(z.string()),
  stackableWithCoupon: z.boolean(),
  description: z.string().min(1),
});

export const couponSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  code: z.string().min(1),
  type: z.enum(['满减', '折扣']),
  threshold: z.number().nonnegative(),
  discount: z.number().nonnegative(),
  status: z.enum(['启用', '停用']),
  validUntil: isoDateSchema,
  newCustomerOnly: z.boolean(),
  applicableProductIds: z.array(z.string()),
  stackableWithActivity: z.boolean(),
  description: z.string().min(1),
});

export const orderItemSchema = z.object({
  productId: idSchema,
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});

export const logisticsEventSchema = z.object({
  at: isoDateSchema,
  description: z.string().min(1),
});

export const logisticsInfoSchema = z.object({
  carrier: z.string().min(1),
  trackingNo: z.string().min(1),
  status: z.enum(['已揽收', '运输中', '派送中', '已签收', '异常']),
  latestEvent: z.string().min(1),
  events: z.array(logisticsEventSchema).min(1),
  updatedAt: isoDateSchema,
});

export const orderSchema = z.object({
  id: idSchema,
  orderNo: z.string().min(1),
  userId: idSchema,
  items: z.array(orderItemSchema).min(1),
  itemSummary: z.string().min(1),
  amount: z.number().nonnegative(),
  status: z.enum(['待发货', '已发货', '已签收', '售后中', '已取消']),
  logisticsStatus: z.enum(['未发货', '已揽收', '运输中', '派送中', '已签收', '异常']),
  afterSalesStatus: z.enum(['无', '处理中', '补发中', '退款中', '已完成']),
  shippingAddressMasked: z.string(),
  logistics: logisticsInfoSchema.nullable(),
  createdAt: isoDateSchema,
});

export const userSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  segment: z.enum(['新客', '复购', '会员']),
  phoneMasked: z.string(),
  joinedAt: isoDateSchema,
  orderCount: z.number().int().nonnegative(),
  isNewCustomer: z.boolean(),
  orderIds: z.array(z.string()),
  preferences: z.object({
    flavors: z.array(z.string()),
    avoidAllergens: z.array(z.string()),
    budget: z.number().positive().optional(),
  }),
});

export const returnPolicySchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  type: z.enum(['破损', '缺件', '退换货', '退款']),
  scope: z.string().min(1),
  windowHours: z.number().int().nonnegative(),
  conditions: z.array(z.string()),
  resolution: z.string().min(1),
  updatedAt: isoDateSchema,
});

export const faqSchema = z.object({
  id: idSchema,
  category: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()),
  updatedAt: isoDateSchema,
});

export const ticketMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export const ticketSchema = z.object({
  id: idSchema,
  customer: z.string().min(1),
  subject: z.string().min(1),
  channel: z.enum(['小程序', '淘宝', '抖音', '京东', 'Agent 工作台', 'Demo']),
  status: z.enum(['待处理', '处理中', '已解决']),
  priority: z.enum(['普通', '紧急']),
  skill: z.string().min(1),
  assignee: z.string(),
  updatedAt: isoDateSchema,
  runId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  source: z.enum(['demo', 'workbench', 'api', 'retry', 'manual']).default('manual'),
  reasonCode: z.string().default('manual_handoff'),
  reason: z.string().default(''),
  knownFacts: z.array(z.string()).default([]),
  missingInfo: z.array(z.string()).default([]),
  suggestedQueue: z.string().default('人工客服'),
  userMessage: z.string().default(''),
  conversationHistory: z.array(ticketMessageSchema).default([]),
});

export const handoffRuleSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  trigger: z.string().min(1),
  conditions: z.array(z.string()),
  action: z.enum(['转人工', '优先人工', '安全阻断后转人工']),
  priority: z.enum(['普通', '紧急']),
  enabled: z.boolean(),
  updatedAt: isoDateSchema,
});

export const skillSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  enabled: z.boolean(),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(100).max(32000),
  requiredTools: z.array(z.string()),
  version: z.string().min(1),
  filePath: z.string().min(1),
  updatedAt: isoDateSchema,
});

export const toolSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  enabled: z.boolean(),
  version: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  updatedAt: isoDateSchema,
});

export const toolsConfigSchema = z.object({
  mode: z.literal('local'),
  defaultTimeoutMs: z.number().int().positive(),
  allowMutations: z.boolean(),
  tools: z.record(
    z.string(),
    z.object({
      enabled: z.boolean(),
      retry: z.number().int().nonnegative(),
    }),
  ),
});

export const skillVersionSchema = z.object({
  id: idSchema,
  skillId: idSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  enabled: z.boolean(),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  requiredTools: z.array(z.string()),
  version: z.string().min(1),
  filePath: z.string().min(1),
  systemPrompt: z.string().min(1),
  hash: z.string().min(16),
  status: z.enum(['当前', '历史', '草稿']),
  changeNote: z.string(),
  createdBy: z.string().min(1),
  createdAt: isoDateSchema,
});

export const skillTestToolRunSchema = z.object({
  toolId: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
  output: z.unknown(),
  durationMs: z.number().int().nonnegative(),
  status: z.enum(['SUCCESS', 'ERROR']),
  error: z.string().nullable(),
});

export const skillTestDependencySchema = z.object({
  toolId: z.string().min(1),
  name: z.string().min(1),
  exists: z.boolean(),
  enabled: z.boolean(),
  status: z.enum(['READY', 'MISSING', 'DISABLED']),
  error: z.string().nullable(),
});

export const skillTestSchema = z.object({
  id: idSchema,
  skillId: idSchema,
  skillVersion: z.string().min(1),
  hash: z.string().min(1),
  provider: z.enum(['classroom-fixture', 'openai-compatible', 'coze']),
  model: z.string().min(1),
  input: z.string().min(1),
  output: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  status: z.enum(['SUCCESS', 'ERROR']),
  error: z.string().nullable(),
  dependencies: z.array(skillTestDependencySchema),
  toolRuns: z.array(skillTestToolRunSchema),
  createdAt: isoDateSchema,
});

export const agentProviderIdSchema = z.enum([
  'classroom-fixture',
  'openai-compatible',
  'coze',
]);

export const planRiskSchema = z.object({
  level: z.enum(['none', 'low', 'medium', 'high']),
  flags: z.array(z.string()),
  requiresHumanHandoff: z.boolean(),
  notes: z.array(z.string()),
});

export const agentPlanSchema = z.object({
  goal: z.string().min(1),
  selectedSkills: z.array(z.string()),
  selectedTools: z.array(z.string()),
  reasoning: z.string(),
  mandatoryCapabilities: z.array(z.string()),
  risk: planRiskSchema,
  fallback: z
    .object({
      required: z.boolean(),
      reason: z.string(),
    })
    .nullable(),
});

export const planIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const planValidationSchema = z.object({
  valid: z.boolean(),
  errors: z.array(planIssueSchema),
  warnings: z.array(planIssueSchema),
  checkedAt: isoDateSchema,
});

export const agentStepSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  type: z.enum(['skill', 'tool']),
  capabilityId: z.string().min(1),
  title: z.string().min(1),
  input: z.unknown(),
  output: z.unknown(),
  durationMs: z.number().int().nonnegative(),
  status: z.enum(['SUCCESS', 'ERROR']),
  error: z.string().nullable(),
  startedAt: isoDateSchema,
  finishedAt: isoDateSchema,
  provider: z.string().optional(),
  model: z.string().optional(),
  version: z.string().optional(),
  hash: z.string().optional(),
});

export const riskViolationSchema = z.object({
  ruleId: z.string().min(1),
  rule: z.string().min(1),
  severity: z.enum(['warning', 'blocking']),
  evidence: z.string(),
  reason: z.string(),
});

export const riskResultSchema = z.object({
  decision: z.enum(['allow', 'block']),
  riskLevel: z.enum(['none', 'low', 'medium', 'high']),
  flags: z.array(z.string()),
  violations: z.array(riskViolationSchema),
  safeReply: z.string().nullable(),
  handoffRequired: z.boolean(),
  checkedBy: z.string().min(1),
  notes: z.array(z.string()),
});

export const evaluationCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['PASS', 'FAIL', 'WARN']),
  detail: z.string(),
});

export const agentEvaluationSchema = z.object({
  score: z.number().min(0).max(100),
  status: z.enum(['PASS', 'FAIL']),
  checks: z.array(evaluationCheckSchema),
  summary: z.string(),
});

export const agentHandoffSchema = z.object({
  status: z.literal('已接管'),
  reason: z.string().min(1),
  by: z.string().min(1),
  at: isoDateSchema,
});

export const skillVersionRefSchema = z.object({
  skillId: z.string().min(1),
  version: z.string().min(1),
  hash: z.string().min(1),
});

export const toolVersionRefSchema = z.object({
  toolId: z.string().min(1),
  version: z.string().min(1),
});

export const runSchema = z.object({
  id: idSchema,
  question: z.string().min(1),
  source: z.enum(['workbench', 'demo', 'retry', 'api']),
  conversationId: z.string().min(1),
  conversationHistory: z.array(ticketMessageSchema).default([]),
  ticketId: z.string().nullable().default(null),
  createdAt: isoDateSchema,
  status: z.enum(['成功', '转人工', '失败', '运行中']),
  finalReply: z.string().nullable(),
  plan: agentPlanSchema.nullable(),
  validation: planValidationSchema.nullable(),
  steps: z.array(agentStepSchema),
  riskResult: riskResultSchema.nullable(),
  durationMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
  errorCode: z.string().nullable(),
  provider: agentProviderIdSchema,
  model: z.string().min(1),
  isDemo: z.boolean(),
  skillVersions: z.array(skillVersionRefSchema),
  toolVersions: z.array(toolVersionRefSchema),
  evaluation: agentEvaluationSchema.nullable(),
  handoff: agentHandoffSchema.nullable(),
  retryOf: z.string().nullable(),
  conversationEnded: z.boolean().default(false),
});

export const ratingMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  at: isoDateSchema.optional(),
});

export const ratingSchema = z.object({
  id: idSchema,
  runId: idSchema,
  conversationId: z.string().optional(),
  score: z.number().int().min(1).max(5),
  comment: z.string().default(''),
  question: z.string().default(''),
  answer: z.string().default(''),
  questionType: z.string().default('未分类'),
  source: z.enum(['demo', 'agent', 'chat', 'ops', 'api']).default('chat'),
  conversation: z.array(ratingMessageSchema).default([]),
  tags: z.array(z.string()).default([]),
  createdAt: isoDateSchema,
});

export const annotationSchema = z.object({
  id: idSchema,
  runId: idSchema,
  target: z.enum(['run', 'reply']).default('run'),
  label: z.string().min(1),
  status: z.enum(['pending', 'accepted', 'rejected', 'evaluating']).default('pending'),
  origin: z.enum([
    'manual',
    'bad-case',
    'low-rating',
    'run-followup',
    'bad-case-evaluation',
    'low-rating-evaluation',
    'run-followup-evaluation',
  ]).default('manual'),
  sourceId: z.string().optional(),
  question: z.string().default(''),
  answer: z.string().default(''),
  expectedReply: z.string().default(''),
  intent: z.string().default('未分类'),
  riskLevel: z.enum(['none', 'low', 'medium', 'high']).default('none'),
  qualityTags: z.array(z.string()).default([]),
  requiredCapabilities: z.array(z.string()).default([]),
  requiredSkills: z.array(z.string()).default([]),
  expectedFacts: z.array(z.string()).default([]),
  expectedToolFacts: z.array(z.string()).default([]),
  forbiddenPhrases: z.array(z.string()).default([]),
  failureReason: z.string().default(''),
  correctness: z.number().int().min(1).max(5).default(3),
  relevance: z.number().int().min(1).max(5).default(3),
  completeness: z.number().int().min(1).max(5).default(3),
  safety: z.number().int().min(1).max(5).default(3),
  tone: z.number().int().min(1).max(5).default(3),
  overall: z.number().int().min(1).max(5).default(3),
  dimensionNotes: z.record(z.string(), z.string()).default({}),
  note: z.string().default(''),
  annotator: z.string().min(1),
  promotedImprovementId: z.string().nullable().optional(),
  promotedEvalCaseId: z.string().nullable().optional(),
  promotedAt: z.string().nullable().optional(),
  createdAt: isoDateSchema,
  updatedAt: z.string().optional(),
});

export const improvementSchema = z.object({
  id: idSchema,
  title: z.string().min(1),
  source: z.string().min(1),
  sourceType: z.enum(['bad-case', 'low-rating', 'low-annotation', 'eval-failure', 'manual']).default('manual'),
  direction: z.enum(['Planner', 'Skill', 'Tool', 'Eval']).default('Skill'),
  description: z.string().default(''),
  ruleCluster: z.boolean().default(false),
  sampleRunIds: z.array(z.string()).default([]),
  suggestedAction: z.string().default(''),
  targetSkillId: z.string().optional(),
  promptDraft: z.string().optional(),
  priority: z.enum(['高', '中', '低']),
  status: z.enum(['待处理', '进行中', '已完成']),
  owner: z.string().min(1),
  createdAt: isoDateSchema,
  updatedAt: z.string().optional(),
});

export const humanScoresSchema = z.object({
  correctness: z.number().int().min(1).max(5),
  relevance: z.number().int().min(1).max(5),
  completeness: z.number().int().min(1).max(5),
  safety: z.number().int().min(1).max(5),
  tone: z.number().int().min(1).max(5),
  overall: z.number().int().min(1).max(5),
});

export const evalConfigSchema = z.object({
  judgeEnabled: z.boolean().default(false),
  judgeSystemPrompt: z.string().trim().min(20).max(50000),
  judgeTemperature: z.number().min(0).max(1).default(0.1),
  updatedAt: isoDateSchema,
});

export const evalCaseSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  question: z.string().min(1),
  scenario: z.string().min(1),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  riskLevel: z.enum(['none', 'low', 'medium', 'high']).default('low'),
  expectedReply: z.string().default(''),
  expectedKeywords: z.array(z.string()).default([]),
  keywordMode: z.enum(['AND', 'OR']).default('AND'),
  forbiddenWords: z.array(z.string()).default([]),
  expectedPrice: z.number().min(0).nullable().default(null),
  expectRiskPassed: z.boolean().default(true),
  requiredCapabilities: z.array(z.string()).default([]),
  forbiddenCapabilities: z.array(z.string()).default([]),
  expectedToolFacts: z.array(z.string()).default([]),
  maxLatencyMs: z.number().int().min(100).max(120000).default(3000),
  humanScores: humanScoresSchema.nullable().default(null),
  evalDimension: z.enum(['correctness', 'relevance', 'completeness', 'safety', 'tone', 'overall']).default('overall'),
  llmJudgePrompt: z.string().default(''),
  tags: z.array(z.string()).default([]),
  sourceRunId: z.string().nullable().optional(),
  createdAt: isoDateSchema,
  enabled: z.boolean().default(true),
});

export const evalBatchCaseResultSchema = z.object({
  caseId: idSchema,
  caseName: z.string().min(1),
  question: z.string(),
  status: z.enum(['PASS', 'FAIL', 'REVIEW', 'ERROR']),
  finalReply: z.string().nullable(),
  reason: z.string(),
  runId: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
  score: z.unknown().nullable(),
});

export const evalBatchSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  status: z.enum([
    '排队中',
    '运行中',
    '已完成',
    'queued',
    'running',
    'done',
    'error',
    'cancelled',
  ]),
  caseCount: z.number().int().nonnegative().default(0),
  passRate: z.number().min(0).max(100).default(0),
  createdAt: isoDateSchema,
  versionLabel: z.string().default('—'),
  changeNote: z.string().default(''),
  caseIds: z.array(idSchema).default([]),
  caseSnapshot: z.array(evalCaseSchema).default([]),
  caseSetHash: z.string().default(''),
  skillVersions: z.array(skillVersionRefSchema).default([]),
  skillVersion: z.string().default('—'),
  skillHash: z.string().default(''),
  evaluatorVersion: z.string().default('—'),
  evaluatorHash: z.string().default(''),
  provider: z.string().default('—'),
  model: z.string().default('—'),
  params: z.record(z.string(), z.unknown()).default({}),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  currentIndex: z.number().int().nonnegative().default(0),
  total: z.number().int().nonnegative().default(0),
  passed: z.number().int().nonnegative().default(0),
  failed: z.number().int().nonnegative().default(0),
  review: z.number().int().nonnegative().default(0),
  errors: z.number().int().nonnegative().default(0),
  caseResults: z.array(evalBatchCaseResultSchema).default([]),
  error: z.string().nullable().optional(),
});

export const abTestSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  status: z.enum(['草稿', '运行中', '已结束', '确认应用']),
  variantA: z.string().min(1),
  variantB: z.string().min(1),
  metric: z.string().min(1),
  sampleSize: z.number().int().nonnegative(),
  winner: z.string().optional(),
  skillId: z.string().optional(),
  skillAId: z.string().optional(),
  skillBId: z.string().optional(),
  promptA: z.string().optional(),
  promptB: z.string().optional(),
  sourceImprovementId: z.string().optional(),
  sourceClusterId: z.string().optional(),
  baseVersion: z.string().optional(),
  baseHash: z.string().optional(),
  draftVersionId: z.string().optional(),
  draftVersion: z.string().optional(),
  confirmedAt: z.string().optional(),
  appliedVersion: z.string().optional(),
  trafficA: z.number().int().min(0).max(100).default(50),
  trafficB: z.number().int().min(0).max(100).default(50),
  enabledA: z.boolean().default(true),
  enabledB: z.boolean().default(true),
  updatedAt: z.string().optional(),
});

export const llmConfigSchema = z.object({
  provider: z.enum(['fixture', 'openai-compatible', 'coze']),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
  configured: z.boolean(),
  managed: z.boolean().default(false),
  updatedAt: isoDateSchema,
});

export const plannerConfigSchema = z.object({
  version: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().min(20).max(50000),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(100).max(32000),
  requiredSkills: z.array(z.string()),
  baseTools: z.array(z.string()),
  priceTools: z.array(z.string()),
  updatedAt: isoDateSchema,
});

export const runtimeFallbackSchema = z.object({
  enabled: z.boolean(),
  strategy: z.literal('human-handoff'),
  message: z.string().min(1),
  updatedAt: isoDateSchema,
});

export const collectionSchemas = {
  products: z.array(productSchema),
  activities: z.array(activitySchema),
  coupons: z.array(couponSchema),
  orders: z.array(orderSchema),
  users: z.array(userSchema),
  'return-policies': z.array(returnPolicySchema),
  faq: z.array(faqSchema),
  tickets: z.array(ticketSchema),
  'handoff-rules': z.array(handoffRuleSchema),
  skills: z.array(skillSchema),
  tools: z.array(toolSchema),
  'tools-config': toolsConfigSchema,
  'skill-versions': z.array(skillVersionSchema),
  'skill-tests': z.array(skillTestSchema),
  runs: z.array(runSchema),
  ratings: z.array(ratingSchema),
  annotations: z.array(annotationSchema),
  improvements: z.array(improvementSchema),
  eval_cases: z.array(evalCaseSchema),
  eval_batches: z.array(evalBatchSchema),
  'eval-config': evalConfigSchema,
  'ab-tests': z.array(abTestSchema),
  'llm-config': llmConfigSchema,
  'planner-config': plannerConfigSchema,
  'runtime-fallback': runtimeFallbackSchema,
} as const;

export type CollectionName = keyof typeof collectionSchemas;
export type CollectionData<K extends CollectionName> = z.infer<(typeof collectionSchemas)[K]>;

export type Product = z.infer<typeof productSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Coupon = z.infer<typeof couponSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type Order = z.infer<typeof orderSchema>;
export type User = z.infer<typeof userSchema>;
export type ReturnPolicy = z.infer<typeof returnPolicySchema>;
export type LogisticsEvent = z.infer<typeof logisticsEventSchema>;
export type LogisticsInfo = z.infer<typeof logisticsInfoSchema>;
export type Faq = z.infer<typeof faqSchema>;
export type Ticket = z.infer<typeof ticketSchema>;
export type HandoffRule = z.infer<typeof handoffRuleSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type Tool = z.infer<typeof toolSchema>;
export type ToolsConfig = z.infer<typeof toolsConfigSchema>;
export type SkillVersion = z.infer<typeof skillVersionSchema>;
export type SkillTestToolRun = z.infer<typeof skillTestToolRunSchema>;
export type SkillTestDependency = z.infer<typeof skillTestDependencySchema>;
export type SkillTest = z.infer<typeof skillTestSchema>;
export type Run = z.infer<typeof runSchema>;
export type AgentPlan = z.infer<typeof agentPlanSchema>;
export type PlanRisk = z.infer<typeof planRiskSchema>;
export type PlanIssue = z.infer<typeof planIssueSchema>;
export type PlanValidation = z.infer<typeof planValidationSchema>;
export type AgentStep = z.infer<typeof agentStepSchema>;
export type RiskViolation = z.infer<typeof riskViolationSchema>;
export type RiskResult = z.infer<typeof riskResultSchema>;
export type EvaluationCheck = z.infer<typeof evaluationCheckSchema>;
export type AgentEvaluation = z.infer<typeof agentEvaluationSchema>;
export type AgentHandoff = z.infer<typeof agentHandoffSchema>;
export type SkillVersionRef = z.infer<typeof skillVersionRefSchema>;
export type ToolVersionRef = z.infer<typeof toolVersionRefSchema>;
export type Rating = z.infer<typeof ratingSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type Improvement = z.infer<typeof improvementSchema>;
export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalBatch = z.infer<typeof evalBatchSchema>;
export type EvalBatchCaseResult = z.infer<typeof evalBatchCaseResultSchema>;
export type EvalConfig = z.infer<typeof evalConfigSchema>;
export type AbTest = z.infer<typeof abTestSchema>;
export type LlmConfig = z.infer<typeof llmConfigSchema>;
export type PlannerConfig = z.infer<typeof plannerConfigSchema>;
export type RuntimeFallback = z.infer<typeof runtimeFallbackSchema>;
