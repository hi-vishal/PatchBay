export type Plan = 'free' | 'pro';
/** `unlimited` comes from a redeemed promo code. It is never a plan you can buy. */
export type AccountPlan = Plan | 'unlimited';
export type LlmProvider = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'ollama';
export type McpTransport = 'stdio' | 'streamable_http' | 'sse';
export type BuiltinTool = 'http_request' | 'web_fetch' | 'calculator' | 'current_time';
export type WorkflowNodeType = 'llm' | 'agent' | 'tool' | 'condition' | 'human_approval';
export type RunStatus = 'pending' | 'running' | 'waiting_approval' | 'succeeded' | 'failed';
export type StepStatus = 'running' | 'succeeded' | 'failed' | 'waiting_approval';

export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  name: string;
  photoURL: string;
  plan: AccountPlan;
  createdAt: string;
}

export interface ModelConfig {
  provider: LlmProvider;
  name: string;
  temperature?: number;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: ModelConfig;
  tools: BuiltinTool[];
  mcpServerIds: string[];
  memoryEnabled: boolean;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AgentInput = Pick<Agent, 'name' | 'model'> &
  Partial<Pick<Agent, 'description' | 'systemPrompt' | 'tools' | 'mcpServerIds' | 'memoryEnabled'>>;

export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  url?: string;
  command?: string;
  args: string[];
  enabled: boolean;
  hasAuth: boolean;
  lastToolSync?: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpAuthInput {
  bearerToken?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface McpServerInput {
  name: string;
  transport: McpTransport;
  url?: string;
  command?: string;
  args?: string[];
  enabled?: boolean;
  auth?: McpAuthInput | null;
}

export interface McpTool {
  name: string;
  description: string;
}

export type McpTestResult =
  { ok: true; tools: McpTool[] } | { ok: false; tools: []; error: string };

export interface Conversation {
  id: string;
  agentId?: string;
  title: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCall {
  id?: string;
  name: string;
  args?: unknown;
  output?: string;
  isError: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  createdAt: string;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label?: string;
  position?: { x: number; y: number };
  config?: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  trigger: { type: 'manual' };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunStep {
  nodeId: string;
  nodeType: string;
  label: string;
  status: StepStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface Run {
  id: string;
  workflowId?: string;
  agentId?: string;
  status: RunStatus;
  input?: unknown;
  output?: unknown;
  steps: RunStep[];
  startedAt?: string;
  endedAt?: string;
  error?: string;
  createdAt: string;
}

export interface ModelDetail {
  id: string;
  label: string;
  supportsTools: boolean;
}

export interface ProviderInfo {
  provider: LlmProvider;
  configured: boolean;
  keySource: 'user' | 'server' | null;
  /** Only free models will run: OpenRouter on the deployment's shared key. */
  freeOnly: boolean;
  models: string[];
  modelDetails?: ModelDetail[];
  supportsTemperature: boolean;
}

export interface ProvidersResponse {
  items: ProviderInfo[];
  default: ModelConfig;
}

export interface ProviderCredential {
  provider: LlmProvider;
  hasKey: boolean;
  keyHint: string | null;
  model: string | null;
}

export interface LlmSettings {
  providers: ProviderCredential[];
  defaultModel: { provider: LlmProvider; name: string } | null;
  ollamaBaseUrl: string | null;
  serverOllama: boolean;
}

export interface LlmSettingsUpdate {
  credentials?: Partial<Record<LlmProvider, { apiKey?: string | null; model?: string | null }>>;
  defaultModel?: { provider: LlmProvider; name: string } | null;
  ollamaBaseUrl?: string | null;
}

export interface OllamaStatus {
  configured: boolean;
  source: 'user' | 'server' | null;
  reachable: boolean;
  models: string[];
  error?: string;
}

export interface PlanLimits {
  messagesPerMonth: number;
  runsPerMonth: number;
  agents: number;
  mcpServers: number;
  workflows: number;
}

/** The limits that apply to the signed-in user. `null` means there is no limit. */
export type AccountLimits = { [K in keyof PlanLimits]: number | null };

export interface PlanInfo {
  id: Plan;
  name: string;
  price: string;
  description: string;
  limits: PlanLimits;
  available: boolean;
}

export interface Usage {
  period: string;
  messages: number;
  runs: number;
  agents: number;
  mcpServers: number;
  workflows: number;
}

export interface Subscription {
  id: string;
  razorpaySubscriptionId: string;
  planId: string;
  status: string;
  currentPeriodEnd?: string;
  cancelAtCycleEnd?: boolean;
  lastEventAt?: string;
}

export interface MeResponse {
  user: User;
  usage: Usage;
  limits: AccountLimits;
  subscription: Subscription | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
