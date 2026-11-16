import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/* A small in-memory stand-in for the API, shaped like the real responses. */

type Doc = Record<string, unknown> & { id: string };

let nextId = 1;
const newId = () => String(nextId++).padStart(24, '0');
const now = () => new Date().toISOString();

const user = {
  id: 'user-1',
  firebaseUid: 'e2e-user',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  photoURL: '',
  plan: 'free',
  createdAt: now(),
};

let subscription: Record<string, unknown> | null = null;

const LLM_PROVIDER_IDS = ['openai', 'anthropic', 'google', 'openrouter', 'ollama'];

const FREE_MODELS = [
  { id: 'openrouter/free', label: 'Best free model (auto)', supportsTools: true },
  { id: 'vendor/fast:free', label: 'Vendor: Fast', supportsTools: true },
  { id: 'vendor/plain:free', label: 'Vendor: Plain', supportsTools: false },
];

/** Real API keys never come back from the API, so only a flag and a hint are kept here. */
let llmSettings = {
  keys: {} as Record<string, { hasKey: boolean; keyHint: string | null; model: string | null }>,
  defaultModel: null as { provider: string; name: string } | null,
  ollamaBaseUrl: null as string | null,
};

function llmSettingsResponse() {
  return {
    providers: LLM_PROVIDER_IDS.map((provider) => ({
      provider,
      hasKey: llmSettings.keys[provider]?.hasKey ?? false,
      keyHint: llmSettings.keys[provider]?.keyHint ?? null,
      model: llmSettings.keys[provider]?.model ?? null,
    })),
    defaultModel: llmSettings.defaultModel,
    ollamaBaseUrl: llmSettings.ollamaBaseUrl,
    serverOllama: false,
  };
}

function updateLlmSettings(body: {
  credentials?: Record<string, { apiKey?: string | null; model?: string | null }>;
  defaultModel?: { provider: string; name: string } | null;
  ollamaBaseUrl?: string | null;
}) {
  for (const [provider, change] of Object.entries(body.credentials ?? {})) {
    const current = llmSettings.keys[provider] ?? { hasKey: false, keyHint: null, model: null };
    llmSettings.keys[provider] = {
      hasKey: change.apiKey === null ? false : Boolean(change.apiKey) || current.hasKey,
      keyHint:
        change.apiKey === null ? null : change.apiKey ? change.apiKey.slice(-4) : current.keyHint,
      model: change.model === undefined ? current.model : change.model,
    };
  }
  if (body.defaultModel !== undefined) llmSettings.defaultModel = body.defaultModel;
  if (body.ollamaBaseUrl !== undefined) llmSettings.ollamaBaseUrl = body.ollamaBaseUrl;
}

function ollamaStatus() {
  const connected = Boolean(llmSettings.ollamaBaseUrl);
  return {
    configured: connected,
    source: connected ? 'user' : null,
    reachable: connected,
    models: connected ? ['llama3.2:latest'] : [],
  };
}

function keySource(provider: string) {
  return llmSettings.keys[provider]?.hasKey ? 'user' : null;
}

function withSaved(provider: string, models: string[]) {
  const saved = llmSettings.keys[provider]?.model;
  return [...new Set([...(saved ? [saved] : []), ...models])];
}

const LIMITS = {
  free: { messagesPerMonth: 50, runsPerMonth: 20, agents: 2, mcpServers: 1, workflows: 2 },
  pro: { messagesPerMonth: 2000, runsPerMonth: 500, agents: 50, mcpServers: 20, workflows: 50 },
  // Infinity reaches the client as null, the same as the real API.
  unlimited: {
    messagesPerMonth: Infinity,
    runsPerMonth: Infinity,
    agents: Infinity,
    mcpServers: Infinity,
    workflows: Infinity,
  },
};

function seed() {
  const mcp: Doc = {
    id: newId(),
    name: 'GitHub',
    transport: 'streamable_http',
    url: 'https://mcp.example.com/github',
    args: [],
    enabled: true,
    hasAuth: true,
    lastToolSync: now(),
    createdAt: now(),
    updatedAt: now(),
  };
  const agent: Doc = {
    id: newId(),
    name: 'Release helper',
    description: 'Reads recent deploys and drafts the release notes.',
    systemPrompt: 'You write short, accurate release notes.',
    model: { provider: 'anthropic', name: 'claude-opus-5-5', temperature: 0.7 },
    tools: ['web_fetch', 'calculator'],
    mcpServerIds: [mcp.id],
    memoryEnabled: true,
    isPublic: false,
    createdAt: now(),
    updatedAt: now(),
  };
  const conversation: Doc = {
    id: newId(),
    title: 'Why did Tuesday’s deploy fail?',
    threadId: 'thread-1',
    createdAt: now(),
    updatedAt: now(),
  };
  const workflow: Doc = {
    id: newId(),
    name: 'Triage new bug reports',
    description: 'Summarize a report, then ask a person before filing it.',
    enabled: true,
    trigger: { type: 'manual' },
    nodes: [
      {
        id: 'summarize',
        type: 'llm',
        label: 'Summarize',
        position: { x: 40, y: 120 },
        config: { prompt: 'Summarize this bug report: {{input}}' },
      },
      {
        id: 'check',
        type: 'condition',
        label: 'Is it urgent?',
        position: { x: 340, y: 120 },
        config: { source: '{{last}}', operator: 'contains', value: 'crash' },
      },
      {
        id: 'approve',
        type: 'human_approval',
        label: 'Page on-call?',
        position: { x: 640, y: 30 },
        config: { message: 'This looks urgent. Page on-call?' },
      },
      {
        id: 'file',
        type: 'tool',
        label: 'File the ticket',
        position: { x: 640, y: 240 },
        config: { tool: 'http_request', args: { url: 'https://example.com/tickets' } },
      },
    ],
    edges: [
      { id: 'e1', source: 'summarize', target: 'check' },
      { id: 'e2', source: 'check', target: 'approve', sourceHandle: 'true' },
      { id: 'e3', source: 'check', target: 'file', sourceHandle: 'false' },
    ],
    createdAt: now(),
    updatedAt: now(),
  };
  return { mcp, agent, conversation, workflow };
}

function freshDb() {
  const seeded = seed();
  return {
    agents: [seeded.agent] as Doc[],
    mcp: [seeded.mcp] as Doc[],
    conversations: [seeded.conversation] as Doc[],
    workflows: [seeded.workflow] as Doc[],
    runs: [] as Doc[],
    messages: [
      {
        id: newId(),
        conversationId: seeded.conversation.id,
        role: 'user',
        content: 'Why did Tuesday’s deploy fail?',
        toolCalls: [],
        createdAt: now(),
      },
      {
        id: newId(),
        conversationId: seeded.conversation.id,
        role: 'assistant',
        content:
          'The deploy failed because the **database migration timed out** after 300 seconds. Rolling back took 4 minutes.',
        toolCalls: [
          {
            id: 'c0',
            name: 'web_fetch',
            args: { url: 'https://ci.example.com/runs/4821' },
            output: 'Run 4821 failed at step migrate: timeout after 300s',
            isError: false,
          },
        ],
        usage: { inputTokens: 812, outputTokens: 96, totalTokens: 908 },
        createdAt: now(),
      },
    ] as Doc[],
    usage: { messages: 12, runs: 3 },
  };
}

let db = freshDb();

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}));
  });
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function planLimit(res: ServerResponse, resource: string): void {
  send(res, 402, {
    error: {
      code: 'PLAN_LIMIT_REACHED',
      message: `You have used all the ${resource} on your plan. Upgrade to Pro to add more.`,
      details: { resource },
    },
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function streamChat(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string | undefined,
): Promise<void> {
  const body = await readBody(req);
  const message = String(body.message ?? '');
  const retrying = body.retry === true;

  if (db.usage.messages >= LIMITS[user.plan as keyof typeof LIMITS].messagesPerMonth) {
    planLimit(res, 'messages');
    return;
  }
  if (message.includes('fail before') && !retrying) {
    send(res, 503, { error: { code: 'LLM_NOT_CONFIGURED', message: 'No API key is set.' } });
    return;
  }
  db.usage.messages += 1;

  let conversation = db.conversations.find((item) => item.id === body.conversationId);
  if (!conversation) {
    conversation = {
      id: newId(),
      agentId,
      title: message.slice(0, 60),
      threadId: newId(),
      createdAt: now(),
      updatedAt: now(),
    };
    db.conversations.unshift(conversation);
  }
  const conversationId = conversation.id;

  // Like the real API, a retry reuses the saved message and drops the unfinished reply.
  const thread = db.messages.filter((item) => item.conversationId === conversationId);
  const lastUser = thread.findLast((item) => item.role === 'user');
  if (retrying && lastUser?.content === message) {
    const abandoned = thread.slice(thread.indexOf(lastUser) + 1);
    db.messages = db.messages.filter((item) => !abandoned.includes(item));
  } else {
    db.messages.push({
      id: newId(),
      conversationId,
      role: 'user',
      content: message,
      toolCalls: [],
      createdAt: now(),
    });
  }

  const saveReply = (content: string, toolCalls: unknown[] = []): Doc => {
    const saved: Doc = {
      id: newId(),
      conversationId,
      role: 'assistant',
      content,
      toolCalls,
      createdAt: now(),
    };
    db.messages.push(saved);
    return saved;
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('X-Conversation-Id', conversationId);
  res.flushHeaders();
  const emit = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (message.includes('fail partway') && !retrying) {
    emit('token', { text: 'Half a reply' });
    await wait(50);
    saveReply('Half a reply');
    emit('error', { code: 'LLM_RATE_LIMITED', message: 'The AI provider is rate limiting.' });
    res.end();
    return;
  }

  if (message.includes('slowly') && !retrying) {
    let disconnected = false;
    res.on('close', () => {
      disconnected = true;
    });
    let sent = '';
    for (let word = 1; word <= 60 && !disconnected; word += 1) {
      sent += `word${word} `;
      emit('token', { text: `word${word} ` });
      await wait(100);
    }
    // The real API also saves a stopped reply a moment after the disconnect.
    await wait(150);
    saveReply(sent.trim());
    res.end();
    return;
  }

  const toolCalls: unknown[] = [];
  if (agentId) {
    const args = { expression: '6 * 7' };
    emit('tool_start', { id: 't1', name: 'calculator', input: args });
    await wait(350);
    emit('tool_end', { id: 't1', name: 'calculator', output: '42', isError: false });
    toolCalls.push({ id: 't1', name: 'calculator', args, output: '42', isError: false });
  }

  const reply = message.includes('show code')
    ? 'Here it is:\n\n```ts\nconst answer = 42;\n```\n'
    : `You said "${message}". The answer is **42**.`;
  for (const word of reply.match(/\S+\s*/g) ?? []) {
    emit('token', { text: word });
    await wait(30);
  }

  const usage = { inputTokens: 40, outputTokens: 12, totalTokens: 52 };
  const saved = saveReply(reply, toolCalls);
  saved.usage = usage;
  emit('done', { conversationId, messageId: saved.id, usage });
  res.end();
}

function startRun(workflow: Doc, input: string): Doc {
  const first = (workflow.nodes as { id: string; type: string; label: string }[])[0];
  const run: Doc = {
    id: newId(),
    workflowId: workflow.id,
    status: 'waiting_approval',
    input,
    steps: first
      ? [
          {
            nodeId: first.id,
            nodeType: first.type,
            label: first.label,
            status: 'succeeded',
            input: { prompt: input },
            output: 'A crash on login after the latest deploy.',
          },
          {
            nodeId: 'approve',
            nodeType: 'human_approval',
            label: 'Page on-call?',
            status: 'waiting_approval',
            input: { message: 'This looks urgent. Page on-call?' },
          },
        ]
      : [],
    startedAt: now(),
    createdAt: now(),
  };
  db.runs.unshift(run);
  return run;
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname.replace(/^\/api/, '');
  const method = req.method ?? 'GET';
  const parts = path.split('/').filter(Boolean);
  const [resource, id, action] = parts;

  if (path === '/health') return send(res, 200, { status: 'ok' });
  if (path === '/__reset' && method === 'POST') {
    db = freshDb();
    user.plan = 'free';
    subscription = null;
    llmSettings = { keys: {}, defaultModel: null, ollamaBaseUrl: null };
    return send(res, 204);
  }
  if (path === '/billing/plans') {
    return send(res, 200, {
      items: [
        {
          id: 'free',
          name: 'Free',
          price: '₹0',
          description: 'Try every feature with low limits.',
          limits: LIMITS.free,
          available: true,
        },
        {
          id: 'pro',
          name: 'Pro',
          price: '₹999 per month',
          description: 'For agents you run every day.',
          limits: LIMITS.pro,
          available: true,
        },
      ],
    });
  }

  if (req.headers.authorization !== 'Bearer e2e-token') {
    return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
  }

  if (path === '/auth/sync' && method === 'POST') return send(res, 200, { user });
  if (path === '/me') {
    return send(res, 200, {
      user,
      usage: {
        period: now().slice(0, 7),
        ...db.usage,
        agents: db.agents.length,
        mcpServers: db.mcp.length,
        workflows: db.workflows.length,
      },
      limits: LIMITS[user.plan as keyof typeof LIMITS],
      subscription,
    });
  }
  if (path === '/llm/providers') {
    const ollama = ollamaStatus();
    return send(res, 200, {
      default: llmSettings.defaultModel ?? { provider: 'anthropic', name: 'claude-opus-5-5' },
      items: [
        {
          provider: 'anthropic',
          configured: true,
          keySource: keySource('anthropic') ?? 'server',
          freeOnly: false,
          models: withSaved('anthropic', [
            'claude-opus-5-5',
            'claude-sonnet-5-5',
            'claude-haiku-5-5',
          ]),
          supportsTemperature: false,
        },
        {
          provider: 'openai',
          configured: Boolean(keySource('openai')),
          keySource: keySource('openai'),
          freeOnly: false,
          models: withSaved('openai', ['gpt-5.2']),
          supportsTemperature: true,
        },
        {
          provider: 'google',
          configured: Boolean(keySource('google')),
          keySource: keySource('google'),
          freeOnly: false,
          models: withSaved('google', ['gemini-2.5-pro']),
          supportsTemperature: true,
        },
        {
          provider: 'openrouter',
          configured: Boolean(keySource('openrouter')),
          keySource: keySource('openrouter'),
          freeOnly: !keySource('openrouter'),
          models: withSaved(
            'openrouter',
            FREE_MODELS.map((model) => model.id),
          ),
          modelDetails: FREE_MODELS,
          supportsTemperature: true,
        },
        {
          provider: 'ollama',
          configured: ollama.reachable,
          keySource: null,
          freeOnly: false,
          models: withSaved('ollama', ollama.models),
          supportsTemperature: true,
        },
      ],
    });
  }
  if (path === '/llm/settings' && method === 'PATCH') {
    const body = await readBody(req);
    if (body.ollamaBaseUrl && /localhost|127\.0\.0\.1/.test(String(body.ollamaBaseUrl))) {
      return send(res, 400, {
        error: {
          code: 'OLLAMA_URL_NOT_ALLOWED',
          message: 'Settings only accepts public addresses.',
        },
      });
    }
    updateLlmSettings(body as Parameters<typeof updateLlmSettings>[0]);
    return send(res, 200, llmSettingsResponse());
  }
  if (path === '/llm/settings') return send(res, 200, llmSettingsResponse());
  if (path === '/llm/ollama/status') return send(res, 200, ollamaStatus());

  if (path === '/chat' && method === 'POST') return streamChat(req, res, undefined);
  if (resource === 'agents' && action === 'chat') return streamChat(req, res, id);

  if (resource === 'billing' && id === 'subscribe') {
    return send(res, 200, { subscriptionId: 'sub_e2e', keyId: 'rzp_test_e2e' });
  }
  if (resource === 'billing' && id === 'verify') {
    user.plan = 'pro';
    subscription = {
      id: 'subscription-1',
      razorpaySubscriptionId: 'sub_e2e',
      planId: 'plan_e2e',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
    return send(res, 200, { subscription });
  }
  if (resource === 'billing' && id === 'redeem') {
    const body = await readBody(req);
    if (user.plan === 'unlimited') {
      return send(res, 409, {
        error: { code: 'CONFLICT', message: 'Your account already has unlimited use.' },
      });
    }
    if (
      String(body.code ?? '')
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '') !== 'PBE2E00TEST0CODE0'
    ) {
      return send(res, 400, {
        error: {
          code: 'INVALID_PROMO_CODE',
          message: 'This code is not valid, has expired, or is used up.',
        },
      });
    }
    user.plan = 'unlimited';
    return send(res, 200, { plan: 'unlimited' });
  }
  if (resource === 'billing' && id === 'cancel') {
    if (subscription) subscription.cancelAtCycleEnd = true;
    return send(res, 200, { subscription });
  }

  if (resource === 'runs') {
    if (!id) return send(res, 200, { items: db.runs });
    const run = db.runs.find((item) => item.id === id);
    if (!run) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Run not found' } });
    if (action === 'resume') {
      run.status = 'succeeded';
      run.output = 'Paged on-call.';
      run.endedAt = now();
      (run.steps as { status: string }[]).forEach((step) => (step.status = 'succeeded'));
      return send(res, 202, { run });
    }
    return send(res, 200, { run });
  }

  const collections: Record<string, { list: Doc[]; key: string; limit: keyof typeof LIMITS.free }> =
    {
      agents: { list: db.agents, key: 'agent', limit: 'agents' },
      'mcp-servers': { list: db.mcp, key: 'server', limit: 'mcpServers' },
      workflows: { list: db.workflows, key: 'workflow', limit: 'workflows' },
      conversations: { list: db.conversations, key: 'conversation', limit: 'agents' },
    };
  const collection = resource ? collections[resource] : undefined;
  if (!collection) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'No route' } });
  const { list, key, limit } = collection;

  if (!id) {
    if (method === 'GET') return send(res, 200, { items: list });
    const atLimit =
      resource !== 'conversations' &&
      list.length >= LIMITS[user.plan as keyof typeof LIMITS][limit];
    if (atLimit) return planLimit(res, limit);
    const body = await readBody(req);
    const doc: Doc = {
      description: '',
      systemPrompt: '',
      tools: [],
      mcpServerIds: [],
      memoryEnabled: true,
      nodes: [],
      edges: [],
      enabled: true,
      args: [],
      trigger: { type: 'manual' },
      ...body,
      hasAuth: Boolean(body.auth),
      auth: undefined,
      id: newId(),
      createdAt: now(),
      updatedAt: now(),
    };
    list.unshift(doc);
    return send(res, 201, { [key]: doc });
  }

  const doc = list.find((item) => item.id === id);
  if (!doc) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });

  if (resource === 'conversations' && action === 'messages') {
    return send(res, 200, { items: db.messages.filter((item) => item.conversationId === id) });
  }
  if (resource === 'mcp-servers' && action === 'test') {
    const ok = !String(doc.url).includes('down');
    return send(
      res,
      200,
      ok
        ? {
            ok,
            tools: [
              { name: 'github_list_runs', description: 'List recent workflow runs' },
              { name: 'github_create_issue', description: 'Open a new issue' },
            ],
          }
        : { ok, tools: [], error: 'Timed out after 15s while connecting' },
    );
  }
  if (resource === 'mcp-servers' && action === 'tools') {
    return send(res, 200, {
      items: [
        { name: 'github_list_runs', description: 'List recent workflow runs' },
        { name: 'github_create_issue', description: 'Open a new issue' },
      ],
    });
  }
  if (resource === 'workflows' && action === 'run') {
    const body = await readBody(req);
    db.usage.runs += 1;
    return send(res, 202, { run: startRun(doc, String(body.input ?? '')) });
  }

  if (method === 'GET') return send(res, 200, { [key]: doc });
  if (method === 'PATCH') {
    Object.assign(doc, await readBody(req), { updatedAt: now() });
    return send(res, 200, { [key]: doc });
  }
  if (method === 'DELETE') {
    list.splice(list.indexOf(doc), 1);
    return send(res, 204);
  }
  return send(res, 405, { error: { code: 'METHOD', message: 'Method not allowed' } });
}

export function mockApi(): Plugin {
  return {
    name: 'mock-api',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        req.url = `/api${req.url ?? ''}`;
        void route(req, res);
      });
    },
  };
}
