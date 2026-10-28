import type { AgentPlan } from '@/lib/schemas';
import type {
  AgentProviderId,
  ConversationMessage,
  ProviderSelectionInfo,
} from '@/lib/types';
import type { InputSignals } from '@/lib/agent/signals';
import type { ToolResultSnapshot } from '@/lib/agent/risk';

export type LlmRole = 'system' | 'user' | 'assistant';

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type LlmPurpose = 'planner' | 'skill' | 'skill-draft' | 'judge';

export type FixtureCapability = {
  id: string;
  name: string;
  description: string;
};

export type FixtureContext = {
  task: LlmPurpose;
  userInput: string;
  conversationHistory: ConversationMessage[];
  mandatoryCapabilities: string[];
  signals: InputSignals;
  availableSkills: FixtureCapability[];
  availableTools: FixtureCapability[];
  skillId?: string;
  skillName?: string;
  plan?: AgentPlan;
  toolResults?: ToolResultSnapshot[];
  previousSkills?: { skillId: string; output: string }[];
  candidateReply?: string;
};

export type LlmGenerateRequest = {
  messages: LlmMessage[];
  temperature: number;
  maxTokens?: number;
  json?: boolean;
  model?: string;
  purpose: LlmPurpose;
  fixture: FixtureContext;
};

export type LlmGeneration = {
  text: string;
  provider: AgentProviderId;
  model: string;
  isDemo: boolean;
};

export interface LlmClient {
  readonly info: ProviderSelectionInfo;
  generate(request: LlmGenerateRequest): Promise<LlmGeneration>;
}
