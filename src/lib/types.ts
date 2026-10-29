import type {
  AbTest,
  AgentPlan,
  Annotation,
  EvalBatch,
  EvalCase,
  EvalConfig,
  Improvement,
  LlmConfig,
  PlannerConfig,
  PlanValidation,
  Rating,
  Run,
  SkillTest,
  Ticket,
} from './schemas';

export type {
  AbTest,
  Activity,
  AgentEvaluation,
  AgentHandoff,
  AgentPlan,
  AgentStep,
  Annotation,
  CollectionData,
  CollectionName,
  Coupon,
  EvalBatch,
  EvalBatchCaseResult,
  EvalCase,
  EvalConfig,
  EvaluationCheck,
  Faq,
  HandoffRule,
  Improvement,
  LlmConfig,
  PlannerConfig,
  LogisticsEvent,
  LogisticsInfo,
  Order,
  OrderItem,
  PlanIssue,
  PlanRisk,
  PlanValidation,
  Product,
  Rating,
  ReturnPolicy,
  RiskResult,
  RiskViolation,
  Run,
  RuntimeFallback,
  Skill,
  SkillTest,
  SkillTestDependency,
  SkillTestToolRun,
  SkillVersion,
  SkillVersionRef,
  Ticket,
  Tool,
  ToolVersionRef,
  ToolsConfig,
  User,
} from './schemas';

export type HealthSnapshot = {
  status: 'ok';
  storage: 'json';
  datasetCount: number;
  productCount: number;
  pendingTicketCount: number;
  enabledSkillCount: number;
  enabledToolCount: number;
  provider: string;
  providerConfigured: boolean;
  checkedAt: string;
};

export type RunTrendPoint = {
  label: string;
  success: number;
  handoff: number;
  failed: number;
};

export type DashboardSnapshot = {
  counts: {
    products: number;
    lowStockProducts: number;
    pendingTickets: number;
    enabledSkills: number;
    enabledTools: number;
    evalCases: number;
  };
  pendingTickets: Ticket[];
  recentRuns: Run[];
  runTrend: RunTrendPoint[];
  generatedAt: string;
};

export type ApiErrorBody = {
  error: string;
  code: string;
  details?: unknown;
};

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
  requiredTools: string[];
  version: string;
  filePath: string;
  updatedAt: string;
  hash: string;
  promptLength: number;
};

export type SkillDetail = SkillSummary & {
  systemPrompt: string;
  nextVersion: string;
};

export type SkillVersionSummary = {
  id: string;
  skillId: string;
  version: string;
  status: '当前' | '历史' | '草稿';
  hash: string;
  changeNote: string;
  createdBy: string;
  createdAt: string;
  promptLength: number;
};

export type SkillVersionDetail = SkillVersionSummary & {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  model: string;
  temperature: number;
  maxTokens: number;
  requiredTools: string[];
  filePath: string;
  systemPrompt: string;
};

export type SkillDiffLine = {
  type: 'context' | 'added' | 'removed';
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type SkillDiffTarget = {
  id: string;
  version: string;
  hash: string;
  createdAt: string;
};

export type SkillDiffResponse = {
  from: SkillDiffTarget;
  to: SkillDiffTarget;
  lines: SkillDiffLine[];
  stats: {
    added: number;
    removed: number;
    unchanged: number;
  };
};

export type SkillUpdatePayload = {
  name?: string;
  description: string;
  model: string;
  temperature: number;
  maxTokens: number;
  requiredTools: string[];
  systemPrompt: string;
  changeNote: string;
  expectedHash: string;
};

export type SkillCreatePayload = {
  id: string;
  name: string;
  description: string;
  category: string;
  model: string;
  temperature: number;
  maxTokens: number;
  requiredTools: string[];
  systemPrompt: string;
  enabled?: boolean;
};

export type SkillDraft = SkillCreatePayload & {
  triggerScenarios: string[];
  reviewNotes: string[];
};

export type SkillConfigIssue = {
  code: string;
  message: string;
  severity: 'error' | 'warning';
};

export type SkillDependencyCheck = {
  toolId: string;
  name: string;
  exists: boolean;
  enabled: boolean;
  status: 'READY' | 'MISSING' | 'DISABLED';
  error: string | null;
};

export type SkillConfigCheck = {
  valid: boolean;
  issues: SkillConfigIssue[];
  skill: SkillSummary;
  hash: string;
  filePath: string;
  promptLength: number;
  dependencies: SkillDependencyCheck[];
  checkedAt: string;
};

export type SkillFileResponse = {
  skillId: string;
  filePath: string;
  hash: string;
  content: string;
};

export type SkillTestHistoryResponse = {
  config: SkillConfigCheck;
  tests: SkillTest[];
};

export type SkillTestExecutionResponse = {
  test: SkillTest;
  config: SkillConfigCheck;
};

export type SkillDraftValidation = {
  valid: boolean;
  issues: SkillConfigIssue[];
};

export type SkillDraftResponse = {
  draft: SkillDraft;
  validation: SkillDraftValidation;
  provider: string;
  model: string;
  isDemo: boolean;
  availableTools: ToolSummary[];
};

export type JsonSchema = Record<string, unknown>;

export type ToolSummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  version: string;
  timeoutMs: number;
  executionMode: string;
  implementationPath: string;
  dataSources: string[];
  readOnly: boolean;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  outputExample: unknown;
  sampleInput: unknown;
  fullConfig: Record<string, unknown>;
};

export type ToolUpdatePayload = {
  enabled?: boolean;
  name?: string;
  description?: string;
};

export type ChatRatingResult = {
  rating: import('./schemas').Rating;
  improvement: import('./schemas').Improvement | null;
};

export type RatingsResponse = {
  ratings: Rating[];
  total: number;
  stats: { total: number; averageScore: number; onePointCount: number };
};

export type AnnotationListResponse = {
  annotations: Annotation[];
  total: number;
};

export type AnnotationPromoteResponse = {
  annotation: Annotation;
  improvement?: Improvement;
  evalCase?: import('./schemas').EvalCase;
};

export type OpsSampleRun = {
  id: string;
  question: string;
  status: Run['status'];
  createdAt: string;
  score?: number;
};

export type ImprovementDirection = 'Planner' | 'Skill' | 'Tool' | 'Eval';

export type ImprovementCluster = {
  id: string;
  sourceType: 'bad-case' | 'low-rating' | 'low-annotation' | 'eval-failure';
  title: string;
  description: string;
  primaryDirection: ImprovementDirection;
  directions: { direction: ImprovementDirection; recommendation: string }[];
  sampleRunIds: string[];
  sampleRuns: OpsSampleRun[];
  count: number;
  priority: '高' | '中' | '低';
  ruleCluster: boolean;
  dimensionAverages: Record<string, number | null>;
  userRatingAverage: number | null;
  userRatingCount: number;
};

export type ImprovementCenterResponse = {
  clusters: ImprovementCluster[];
  records: Improvement[];
  generatedAt: string;
};

export type PromptDraftResponse = {
  ruleBased: true;
  notice: string;
  skill: SkillDetail;
  currentPrompt: string;
  currentHash: string;
  draftPrompt: string;
  diff: SkillDiffLine[];
  stats: { added: number; removed: number; unchanged: number };
  cluster: ImprovementCluster | null;
  improvement: Improvement | null;
};

export type EvalScore = import('./eval/scorer').EvalScore;
export type EvalResponse = {
  cases: EvalCase[];
  batches: EvalBatch[];
  skills: SkillSummary[];
  tools: ToolSummary[];
  config: EvalConfig;
  generatedAt: string;
};

export type DetailedEvalScoreResponse = {
  score: import('./eval/detailed-score').DetailedEvalScore;
  run: Run;
  case: EvalCase;
};

export type EvalScoreResponse = {
  score: EvalScore;
  run: Run;
};


export type PromptApplyResponse = {
  skill: SkillDetail;
  improvement: Improvement;
};

export type PromptVersionCreateResponse = {
  draft: PromptDraftResponse;
  version: SkillVersionDetail;
  abTest: AbTest;
  improvement: Improvement | null;
};

export type AbTestsResponse = {
  abTests: AbTest[];
  total: number;
};

export type OpsOverview = {
  totalRuns: number;
  successRate: number;
  averageDurationMs: number;
  failedSteps: number;
  handoffRate: number;
  riskDistribution: { level: string; count: number }[];
  recentRuns: Run[];
  failedStepSamples: { runId: string; question: string; stepId: string; capabilityId: string; error: string | null }[];
  lowRatingCount: number;
  pendingAnnotationCount: number;
  pendingEvaluationCount: number;
  generatedAt: string;
};

export type LlmEnvStatus = {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
};

export type LlmProviderView = {
  id: AgentProviderId;
  label: string;
  description: string;
  defaultModel: string;
  models: string[];
  isDemo: boolean;
  configured: boolean;
  missing: string[];
  env: LlmEnvStatus[];
};

export type LlmCurrentView = {
  provider: AgentProviderId;
  model: string;
  source: ProviderSelectionInfo['source'];
  isDemo: boolean;
  configured: boolean;
  missing: string[];
  notice: string;
  error: string | null;
};

export type LlmConfigView = {
  config: LlmConfig;
  current: LlmCurrentView;
  providers: LlmProviderView[];
  mode: 'demo' | 'real' | 'error';
  banner: string;
  generatedAt: string;
};

export type LlmTestResponse = {
  ok: true;
  provider: AgentProviderId;
  model: string;
  isDemo: boolean;
  durationMs: number;
  message: string;
};

export type PlannerOverviewResponse = {
  config: PlannerConfig;
  plannerVersion: string;
  prompt: string;
  skills: SkillSummary[];
  tools: ToolSummary[];
  generatedAt: string;
};

export type PlannerPreviewRequest = {
  userInput: string;
  conversationHistory?: ConversationMessage[];
  mandatoryCapabilities?: string[];
  skillIds?: string[];
  toolIds?: string[];
  provider?: AgentProviderSelection;
};

export type PlannerPreviewResponse = {
  plan: AgentPlan;
  validation: PlanValidation;
  parseError: string | null;
  provider: AgentProviderId;
  model: string;
  isDemo: boolean;
  mandatoryCapabilities: string[];
  availableSkills: {
    id: string;
    name: string;
    description: string;
    requiredTools: string[];
  }[];
  availableTools: {
    id: string;
    name: string;
    description: string;
  }[];
  signals: {
    scenario: string;
    flags: string[];
    riskLevel: string;
    requiresHumanHandoff: boolean;
    requiredCapabilities: string[];
  };
  plannerVersion: string;
  durationMs: number;
  generatedAt: string;
};

export type RegistrySnapshot = {
  skills: SkillDetail[];
  tools: ToolSummary[];
  generatedAt: string;
};

export type SkillsResponse = {
  skills: SkillSummary[];
  total: number;
  enabled: number;
  generatedAt: string;
};

export type SkillDetailResponse = {
  skill: SkillDetail;
};

export type SkillVersionsResponse = {
  versions: SkillVersionSummary[];
};

export type SkillVersionDetailResponse = {
  version: SkillVersionDetail;
};

export type ToolsResponse = {
  tools: ToolSummary[];
  total: number;
  enabled: number;
  generatedAt: string;
};

export type ToolTestResponse = {
  toolId: string;
  input: unknown;
  durationMs: number;
  output: unknown;
};

export type CatalogTypeInfo = {
  type: string;
  label: string;
  description: string;
  count: number;
  editable: boolean;
};

export type CatalogOverviewResponse = {
  types: CatalogTypeInfo[];
  generatedAt: string;
};

export type CatalogMeta = {
  label: string;
  value: string;
};

export type CatalogRecordSummary = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  meta: CatalogMeta[];
  tags: string[];
  data: Record<string, unknown>;
};

export type CatalogMutationResponse = {
  ok: true;
  record: Record<string, unknown>;
};

export type CatalogRecordsResponse = {
  type: string;
  label: string;
  description: string;
  total: number;
  records: CatalogRecordSummary[];
};

export type AgentProviderId = 'classroom-fixture' | 'openai-compatible' | 'coze';
export type AgentProviderSelection = 'auto' | AgentProviderId;

export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AgentRunRequest = {
  userInput: string;
  conversationHistory?: ConversationMessage[];
  conversationId?: string;
  source?: 'workbench' | 'demo' | 'api';
  provider?: AgentProviderSelection;
  mandatoryCapabilities?: string[];
};

export type AgentStreamEvent =
  | {
      type: 'run';
      run: Run;
    }
  | {
      type: 'plan';
      plan: import('./schemas').AgentPlan;
      validation: import('./schemas').PlanValidation;
      provider: AgentProviderId;
      model: string;
      isDemo: boolean;
    }
  | {
      type: 'step';
      step: import('./schemas').AgentStep;
    }
  | {
      type: 'final';
      finalReply: string;
      riskResult: import('./schemas').RiskResult;
      evaluation: import('./schemas').AgentEvaluation;
      status: Run['status'];
      conversationEnded: boolean;
    }
  | {
      type: 'error';
      error: string;
      code: string;
      run?: Run;
    }
  | {
      type: 'done';
      run: Run;
    };

export type RunAnnotation = import('./schemas').Annotation;

export type RunsResponse = {
  runs: Run[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type RunDetailResponse = {
  run: Run;
  annotations: RunAnnotation[];
};

export type RetryRunResponse = {
  run: Run;
};
export type StepRetryResponse = {
  run: Run;
  step: import('./schemas').AgentStep;
  previousStatus: Run['status'];
};



export type ExplainResponse = {
  runId: string;
  summary: string;
  planReasoning: string;
  riskExplanation: string;
  evidence: string[];
  suggestions: string[];
  generatedAt: string;
};

export type ProviderSelectionInfo = {
  id: AgentProviderId;
  model: string;
  isDemo: boolean;
  source: 'request' | 'environment' | 'config' | 'default-demo';
  notice: string;
};
