import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { HumanMessage } from '@langchain/core/messages';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { LlmSettings } from '../src/models/index.js';
import { clearFreeModelCache, normalizeOllamaUrl } from '../src/services/llm/catalog.js';
import { toClientError } from '../src/services/graphs/turn.js';
import { createChatModel, resolveDefaultModel } from '../src/services/llm/llm.js';
import { decryptJson } from '../src/utils/crypto.js';
import { authHeader, createUser } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

vi.mock('../src/config/firebase.js', async () => {
  const { fakeVerifyFirebaseToken } = await import('./helpers/auth.js');
  return { verifyFirebaseToken: fakeVerifyFirebaseToken };
});

useTestDatabase();
const app = createApp();
const alice = authHeader('alice');
const mallory = authHeader('mallory');
const REAL_KEY = 'sk-or-v1-secret-value-abcd';

const FREE_CATALOG = {
  data: [
    {
      id: 'vendor/zeta:free',
      name: 'Vendor: Zeta (free)',
      pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['tools', 'temperature'],
    },
    {
      id: 'openrouter/free',
      name: 'Free Models Router',
      pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['tools'],
    },
    {
      id: 'vendor/plain:free',
      name: 'Vendor: Plain (free)',
      pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['temperature'],
    },
    {
      id: 'vendor/music:free',
      name: 'Vendor: Music',
      pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text'], output_modalities: ['text', 'audio'] },
    },
    {
      id: 'vendor/content-safety:free',
      name: 'Vendor: Content Safety',
      pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    },
    {
      id: 'vendor/paid',
      name: 'Vendor: Paid',
      pricing: { prompt: '0.000001', completion: '0.000002' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    },
    { id: 'openrouter/auto', name: 'Auto', pricing: { prompt: '-1', completion: '-1' } },
  ],
};

function stubCatalog(): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith('https://openrouter.ai/api/v1/models')
      ? Promise.resolve(Response.json(FREE_CATALOG))
      : realFetch(input, init),
  );
}

beforeEach(async () => {
  await createUser('alice');
  await createUser('mallory');
  clearFreeModelCache();
  stubCatalog();
});

afterEach(() => {
  vi.unstubAllGlobals();
  env.OPENROUTER_API_KEY = undefined;
  env.ANTHROPIC_API_KEY = undefined;
  env.OLLAMA_BASE_URL = undefined;
  env.DEFAULT_MODEL = 'anthropic:claude-opus-5-5';
});

const providerNamed = async (header: Record<string, string>, provider: string) => {
  const response = await request(app).get('/api/llm/providers').set(header);
  expect(response.status).toBe(200);
  return (response.body.items as { provider: string }[]).find(
    (item) => item.provider === provider,
  ) as unknown as {
    configured: boolean;
    keySource: string | null;
    freeOnly: boolean;
    models: string[];
    modelDetails: { id: string; label: string; supportsTools: boolean }[];
  };
};

describe('saving API keys', () => {
  it('encrypts the key and never returns it', async () => {
    const saved = await request(app)
      .patch('/api/llm/settings')
      .set(alice)
      .send({ credentials: { openrouter: { apiKey: REAL_KEY, model: 'vendor/zeta:free' } } });

    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(REAL_KEY);
    expect(saved.body.providers).toContainEqual({
      provider: 'openrouter',
      hasKey: true,
      keyHint: 'abcd',
      model: 'vendor/zeta:free',
    });

    const stored = await LlmSettings.findOne();
    const credential = stored?.credentials[0];
    expect(credential?.encryptedKey).not.toContain(REAL_KEY);
    expect(decryptJson(credential?.encryptedKey ?? '')).toBe(REAL_KEY);

    const read = await request(app).get('/api/llm/settings').set(alice);
    expect(JSON.stringify(read.body)).not.toContain(REAL_KEY);
    expect(JSON.stringify(read.body)).not.toContain(credential?.encryptedKey);
  });

  it('gives no hint for a short key', async () => {
    const saved = await request(app)
      .patch('/api/llm/settings')
      .set(alice)
      .send({ credentials: { openai: { apiKey: 'short-key' } } });
    expect(saved.body.providers).toContainEqual(
      expect.objectContaining({ provider: 'openai', hasKey: true, keyHint: null }),
    );
  });

  it('keeps the key when only the model changes, and removes it on null', async () => {
    const send = (credentials: unknown) =>
      request(app).patch('/api/llm/settings').set(alice).send({ credentials });

    await send({ openrouter: { apiKey: REAL_KEY } });
    const renamed = await send({ openrouter: { model: 'vendor/plain:free' } });
    expect(renamed.body.providers).toContainEqual(
      expect.objectContaining({ provider: 'openrouter', hasKey: true, model: 'vendor/plain:free' }),
    );

    const removed = await send({ openrouter: { apiKey: null } });
    expect(removed.body.providers).toContainEqual({
      provider: 'openrouter',
      hasKey: false,
      keyHint: null,
      model: 'vendor/plain:free',
    });
    const stored = await LlmSettings.findOne();
    expect(stored?.credentials[0]?.encryptedKey).toBeUndefined();
  });

  it.each([
    ['a key with spaces', { credentials: { openai: { apiKey: 'has spaces in it' } } }],
    ['a short key', { credentials: { openai: { apiKey: 'abc' } } }],
    ['an unknown provider', { credentials: { nope: { apiKey: 'sk-1234567890' } } }],
    ['a key for Ollama', { credentials: { ollama: { apiKey: 'sk-1234567890' } } }],
    ['an unknown default provider', { defaultModel: { provider: 'nope', name: 'x' } }],
    ['a non-http Ollama address', { ollamaBaseUrl: 'file:///etc/passwd' }],
  ])('rejects %s', async (_name, body) => {
    const response = await request(app).patch('/api/llm/settings').set(alice).send(body);
    expect(response.status).toBe(400);
  });

  it('keeps each person apart', async () => {
    await request(app)
      .patch('/api/llm/settings')
      .set(alice)
      .send({ credentials: { openrouter: { apiKey: REAL_KEY } } });

    const theirs = await request(app).get('/api/llm/settings').set(mallory);
    expect(theirs.body.providers).toContainEqual(
      expect.objectContaining({ provider: 'openrouter', hasKey: false }),
    );
    expect((await providerNamed(mallory, 'openrouter')).configured).toBe(false);
    expect((await providerNamed(alice, 'openrouter')).keySource).toBe('user');
  });

  it('requires sign-in', async () => {
    expect((await request(app).get('/api/llm/settings')).status).toBe(401);
    expect((await request(app).patch('/api/llm/settings').send({})).status).toBe(401);
    expect((await request(app).get('/api/llm/ollama/status')).status).toBe(401);
  });
});

describe('default model', () => {
  it('uses the saved choice, then clears back to the deployment default', async () => {
    env.ANTHROPIC_API_KEY = 'server-key';
    const send = (defaultModel: unknown) =>
      request(app).patch('/api/llm/settings').set(alice).send({ defaultModel });

    await send({ provider: 'openrouter', name: 'vendor/zeta:free' });
    const chosen = await request(app).get('/api/llm/providers').set(alice);
    expect(chosen.body.default).toEqual({ provider: 'openrouter', name: 'vendor/zeta:free' });

    await send(null);
    const cleared = await request(app).get('/api/llm/providers').set(alice);
    expect(cleared.body.default).toEqual({ provider: 'anthropic', name: 'claude-opus-5-5' });
  });

  it('falls back to a provider that can run, keeping DEFAULT_MODEL when none can', async () => {
    const { User } = await import('../src/models/index.js');
    const user = await User.findOne({ firebaseUid: 'alice' });
    const ownerId = user?._id;
    if (!ownerId) throw new Error('missing user');

    await expect(resolveDefaultModel(ownerId)).resolves.toEqual({
      provider: 'anthropic',
      name: 'claude-opus-5-5',
    });
    env.OPENROUTER_API_KEY = 'server-key';
    await expect(resolveDefaultModel(ownerId)).resolves.toEqual({
      provider: 'openrouter',
      name: 'openrouter/free',
    });
  });
});

describe('OpenRouter free models', () => {
  it('lists only free chat models, with the router first', async () => {
    const info = await providerNamed(alice, 'openrouter');
    expect(info.models).toEqual(['openrouter/free', 'vendor/plain:free', 'vendor/zeta:free']);
    expect(info.modelDetails[0]).toEqual({
      id: 'openrouter/free',
      label: 'Best free model (auto)',
      supportsTools: true,
    });
    expect(info.modelDetails).toContainEqual({
      id: 'vendor/plain:free',
      label: 'Vendor: Plain',
      supportsTools: false,
    });
  });

  it('falls back to the free router when the catalog cannot load', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const info = await providerNamed(alice, 'openrouter');
    expect(info.models).toEqual(['openrouter/free']);
  });

  it('runs only free models on the shared key', async () => {
    env.OPENROUTER_API_KEY = 'server-key';
    await expect(
      createChatModel({ provider: 'openrouter', name: 'vendor/paid' }, null),
    ).rejects.toMatchObject({ code: 'MODEL_NOT_FREE', status: 403 });
    await expect(
      createChatModel({ provider: 'openrouter', name: 'vendor/zeta:free' }, null),
    ).resolves.toBeDefined();
    await expect(
      createChatModel({ provider: 'openrouter', name: 'openrouter/free' }, null),
    ).resolves.toBeDefined();
  });

  it('lets a person run paid models on their own key', async () => {
    env.OPENROUTER_API_KEY = 'server-key';
    await request(app)
      .patch('/api/llm/settings')
      .set(alice)
      .send({ credentials: { openrouter: { apiKey: REAL_KEY, model: 'vendor/paid' } } });

    const { User } = await import('../src/models/index.js');
    const user = await User.findOne({ firebaseUid: 'alice' });
    await expect(
      createChatModel({ provider: 'openrouter', name: 'vendor/paid' }, user?._id ?? null),
    ).resolves.toBeDefined();

    const info = await providerNamed(alice, 'openrouter');
    expect(info.freeOnly).toBe(false);
    expect(info.models[0]).toBe('vendor/paid');
    // Someone on the shared key is not offered a paid model.
    expect((await providerNamed(mallory, 'openrouter')).freeOnly).toBe(true);
  });

  it('reports a missing key clearly', async () => {
    await expect(
      createChatModel({ provider: 'openrouter', name: 'openrouter/free' }, null),
    ).rejects.toMatchObject({ code: 'LLM_NOT_CONFIGURED', status: 503 });
  });
});

/** Stands in for Ollama or OpenRouter: the tags list, and a streaming chat completion. */
function fakeOpenAiServer(): Promise<{
  baseUrl: string;
  requests: { url?: string; authorization?: string; body: Record<string, unknown> }[];
  close: () => Promise<void>;
}> {
  const requests: { url?: string; authorization?: string; body: Record<string, unknown> }[] = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen3:8b' }] }));
      return;
    }
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      requests.push({
        url: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      res.setHeader('content-type', 'text/event-stream');
      for (const content of ['Hello', ' from', ' local']) {
        res.write(
          `data: ${JSON.stringify({
            id: 'c1',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'fake',
            choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
          })}\n\n`,
        );
      }
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

describe('Ollama', () => {
  it('cleans up pasted addresses', () => {
    expect(normalizeOllamaUrl('http://localhost:11434/')).toBe('http://localhost:11434');
    expect(normalizeOllamaUrl('http://localhost:11434/v1')).toBe('http://localhost:11434');
    expect(normalizeOllamaUrl('https://x.example.com/ollama/api/')).toBe(
      'https://x.example.com/ollama',
    );
  });

  it('says when nothing is set up', async () => {
    const status = await request(app).get('/api/llm/ollama/status').set(alice);
    expect(status.body).toEqual({ configured: false, source: null, reachable: false, models: [] });
    expect((await providerNamed(alice, 'ollama')).configured).toBe(false);
    await expect(createChatModel({ provider: 'ollama', name: 'x' }, null)).rejects.toMatchObject({
      code: 'LLM_NOT_CONFIGURED',
    });
  });

  it('lists installed models and streams from the server-configured address', async () => {
    const fake = await fakeOpenAiServer();
    env.OLLAMA_BASE_URL = fake.baseUrl;
    try {
      const status = await request(app).get('/api/llm/ollama/status').set(alice);
      expect(status.body).toEqual({
        configured: true,
        source: 'server',
        reachable: true,
        models: ['llama3.2:latest', 'qwen3:8b'],
      });
      const info = await providerNamed(alice, 'ollama');
      expect(info.configured).toBe(true);
      expect(info.models).toEqual(['llama3.2:latest', 'qwen3:8b']);

      const model = await createChatModel(
        { provider: 'ollama', name: 'llama3.2:latest', temperature: 0.2 },
        null,
      );
      let text = '';
      for await (const chunk of await model.stream([new HumanMessage('Hi')])) text += chunk.text;

      expect(text).toBe('Hello from local');
      expect(fake.requests[0]?.url).toBe('/v1/chat/completions');
      expect(fake.requests[0]?.body).toMatchObject({ model: 'llama3.2:latest', temperature: 0.2 });
    } finally {
      await fake.close();
    }
  });

  it('reports a server that is not running', async () => {
    env.OLLAMA_BASE_URL = 'http://127.0.0.1:9';
    const status = await request(app).get('/api/llm/ollama/status').set(alice);
    expect(status.body).toMatchObject({ configured: true, reachable: false, models: [] });
    expect(status.body.error).toMatch(/Could not connect/);
  });

  it('tells the person to check Ollama when a message cannot reach it', async () => {
    env.OLLAMA_BASE_URL = 'http://127.0.0.1:9';
    const model = await createChatModel({ provider: 'ollama', name: 'llama3.2' }, null);
    const failure: unknown = await model.invoke([new HumanMessage('Hi')]).catch((e: unknown) => e);
    expect(toClientError(failure).code).toBe('LLM_UNREACHABLE');
  });

  it.each([
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'http://169.254.169.254/latest',
    'http://[::1]:11434',
    'http://192.168.1.20:11434',
    'http://ollama.internal:11434',
  ])('refuses %s from Settings', async (ollamaBaseUrl) => {
    const response = await request(app)
      .patch('/api/llm/settings')
      .set(alice)
      .send({ ollamaBaseUrl, credentials: { openai: { model: 'unsaved' } } });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OLLAMA_URL_NOT_ALLOWED');
    expect(await LlmSettings.findOne()).toBeNull();
  });

  it('applies the SSRF checks when a saved address later points inward', async () => {
    const fake = await fakeOpenAiServer();
    try {
      const { User } = await import('../src/models/index.js');
      const user = await User.findOne({ firebaseUid: 'alice' });
      // As if a public name had been saved and later rebound to a private address.
      await LlmSettings.create({ ownerId: user?._id, ollamaBaseUrl: fake.baseUrl });

      const status = await request(app).get('/api/llm/ollama/status').set(alice);
      expect(status.body).toMatchObject({ source: 'user', reachable: false });

      const model = await createChatModel(
        { provider: 'ollama', name: 'llama3.2:latest' },
        user?._id ?? null,
      );
      await expect(model.invoke([new HumanMessage('Hi')])).rejects.toThrow();
      expect(fake.requests).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });
});
