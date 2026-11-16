import type { StructuredToolInterface } from '@langchain/core/tools';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { McpServer } from '../src/models/index.js';
import type { McpServerDoc } from '../src/models/index.js';
import { inspectMcpServer, loadMcpToolset } from '../src/services/mcp/manager.js';
import { encryptJson } from '../src/utils/crypto.js';
import { authHeader, createUser } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';
import type { TestMcpServer } from './helpers/mcpServer.js';
import { startTestMcpServer } from './helpers/mcpServer.js';

vi.mock('../src/config/firebase.js', async () => {
  const { fakeVerifyFirebaseToken } = await import('./helpers/auth.js');
  return { verifyFirebaseToken: fakeVerifyFirebaseToken };
});

useTestDatabase();

const app = createApp();
const alice = authHeader('alice');
let live: TestMcpServer;

const ownerId = () => createUser(`owner-${Math.random()}`).then((user) => user._id);

async function savedServer(fields: Record<string, unknown>): Promise<McpServerDoc> {
  return McpServer.create({
    ownerId: await ownerId(),
    name: 'My Tools!',
    transport: 'streamable_http',
    url: live.url,
    ...fields,
  });
}

function toolNamed(tools: StructuredToolInterface[], suffix: string) {
  const found = tools.find((tool) => tool.name.endsWith(suffix));
  if (!found) throw new Error(`No tool ending in ${suffix}`);
  return found;
}

beforeAll(async () => {
  live = await startTestMcpServer();
});

afterAll(async () => {
  await live.stop();
});

beforeEach(() => {
  env.MCP_ALLOW_PRIVATE_NETWORKS = true;
  live.authHeaders.length = 0;
});

afterEach(() => {
  env.MCP_ALLOW_PRIVATE_NETWORKS = false;
  env.MCP_ALLOW_STDIO = false;
});

describe('loadMcpToolset', () => {
  it('loads tools from a real server and calls them', async () => {
    const toolset = await loadMcpToolset([await savedServer({})]);
    try {
      expect(toolset.failures).toEqual([]);
      const add = toolNamed(toolset.tools, 'add');
      expect(add.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(add.name).toContain('my_tools');
      const output = await add.invoke({ a: 2, b: 40 });
      expect(JSON.stringify(output)).toContain('42');
    } finally {
      await toolset.close();
    }
  });

  it('sends decrypted credentials to the server', async () => {
    const toolset = await loadMcpToolset([
      await savedServer({ encryptedAuth: encryptJson({ bearerToken: 'mcp-secret' }) }),
    ]);
    await toolset.close();
    expect(live.authHeaders).toContain('Bearer mcp-secret');
  });

  it('reports a failing server without losing the working one', async () => {
    const dead = await savedServer({ name: 'Dead', url: 'http://127.0.0.1:9/mcp' });
    const working = await savedServer({});

    const toolset = await loadMcpToolset([dead, working]);
    try {
      expect(toolset.failures).toHaveLength(1);
      expect(toolset.failures[0]).toMatchObject({ serverName: 'Dead' });
      expect(toolset.failures[0]?.error).toBeTruthy();
      expect(toolNamed(toolset.tools, 'add')).toBeDefined();
    } finally {
      await toolset.close();
    }
  });

  it('turns a failing tool call into a catchable error', async () => {
    const toolset = await loadMcpToolset([await savedServer({})]);
    try {
      const explode = toolNamed(toolset.tools, 'explode');
      await expect(explode.invoke({})).rejects.toThrow();
    } finally {
      await toolset.close();
    }
  });

  it('reports corrupt credentials as a failure rather than crashing', async () => {
    const toolset = await loadMcpToolset([await savedServer({ encryptedAuth: 'garbage' })]);
    expect(toolset.tools).toEqual([]);
    expect(toolset.failures).toHaveLength(1);
    await toolset.close();
  });

  it('blocks private addresses unless the deployment allows them', async () => {
    env.MCP_ALLOW_PRIVATE_NETWORKS = false;
    const toolset = await loadMcpToolset([await savedServer({})]);
    expect(toolset.tools).toEqual([]);
    expect(toolset.failures[0]?.error).toMatch(/not allowed/);
    expect(live.authHeaders).toEqual([]);
    await toolset.close();
  });

  it('never starts a stdio server when stdio is disabled', async () => {
    const toolset = await loadMcpToolset([
      await savedServer({ transport: 'stdio', url: undefined, command: 'node', args: ['-v'] }),
    ]);
    expect(toolset.tools).toEqual([]);
    expect(toolset.failures[0]?.error).toMatch(/disabled/);
    await toolset.close();
  });
});

describe('inspectMcpServer', () => {
  it('lists tool names and descriptions', async () => {
    const result = await inspectMcpServer(await savedServer({}));
    expect(result.ok).toBe(true);
    expect(result.tools.map((tool) => tool.description)).toContain('Add two numbers');
  });

  it('returns the failure instead of throwing', async () => {
    const result = await inspectMcpServer(await savedServer({ url: 'http://127.0.0.1:9/mcp' }));
    expect(result.ok).toBe(false);
  });
});

describe('MCP routes', () => {
  beforeEach(async () => {
    await createUser('alice');
    await createUser('mallory');
  });

  const create = (url = live.url) =>
    request(app)
      .post('/api/mcp-servers')
      .set(alice)
      .send({ name: 'Tools', transport: 'streamable_http', url });

  it('tests a server and records the sync time', async () => {
    const { body } = await create();
    expect(body.server.lastToolSync).toBeUndefined();

    const res = await request(app).post(`/api/mcp-servers/${body.server.id}/test`).set(alice);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const stored = await McpServer.findById(body.server.id);
    expect(stored?.lastToolSync).toBeInstanceOf(Date);
  });

  it('lists tools', async () => {
    const { body } = await create();
    const res = await request(app).get(`/api/mcp-servers/${body.server.id}/tools`).set(alice);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
  });

  it('returns 502 from the tools route when the server is down', async () => {
    const { body } = await create('http://127.0.0.1:9/mcp');
    const res = await request(app).get(`/api/mcp-servers/${body.server.id}/tools`).set(alice);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('MCP_CONNECT_FAILED');
  });

  it('keeps these routes owner-only', async () => {
    const { body } = await create();
    const mallory = authHeader('mallory');
    const test = await request(app).post(`/api/mcp-servers/${body.server.id}/test`).set(mallory);
    const tools = await request(app).get(`/api/mcp-servers/${body.server.id}/tools`).set(mallory);
    expect(test.status).toBe(404);
    expect(tools.status).toBe(404);
  });
});
