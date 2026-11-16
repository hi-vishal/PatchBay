/** API shape for documents: expose `id`, hide `_id` and `__v`. */
export const jsonOptions = {
  virtuals: true,
  versionKey: false,
  transform(_doc: unknown, ret: Record<string, unknown>) {
    delete ret._id;
    return ret;
  },
};

export const PLANS = ['free', 'pro'] as const;
export type Plan = (typeof PLANS)[number];

/** What a user actually gets. `unlimited` comes from a promo code, never from billing. */
export const EFFECTIVE_PLANS = [...PLANS, 'unlimited'] as const;
export type EffectivePlan = (typeof EFFECTIVE_PLANS)[number];

export const LLM_PROVIDERS = ['openai', 'anthropic', 'google', 'openrouter', 'ollama'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const MCP_TRANSPORTS = ['stdio', 'streamable_http', 'sse'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const WORKFLOW_NODE_TYPES = ['llm', 'agent', 'tool', 'condition', 'human_approval'] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const RUN_STATUSES = [
  'pending',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = ['running', 'succeeded', 'failed', 'waiting_approval'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const SUBSCRIPTION_STATUSES = [
  'created',
  'authenticated',
  'active',
  'pending',
  'halted',
  'paused',
  'cancelled',
  'completed',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
