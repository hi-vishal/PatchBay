import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { Agent, Conversation, McpServer, Message } from '../src/models/index.js';
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

const agentBody = {
  name: 'Researcher',
  systemPrompt: 'Be helpful',
  model: { provider: 'openai', name: 'gpt-5.2' },
  tools: ['calculator'],
};
const mcpBody = {
  name: 'Tools',
  transport: 'streamable_http',
  url: 'https://mcp.example.com/mcp',
};

beforeEach(async () => {
  await createUser('alice');
  await createUser('mallory');
});

describe('agents', () => {
  it('creates, reads, updates, lists and deletes', async () => {
    const created = await request(app).post('/api/agents').set(alice).send(agentBody);
    expect(created.status).toBe(201);
    expect(created.body.agent.model.temperature).toBe(0.7);
    const { id } = created.body.agent;

    const updated = await request(app)
      .patch(`/api/agents/${id}`)
      .set(alice)
      .send({ description: 'Finds things' });
    expect(updated.body.agent.description).toBe('Finds things');
    expect(updated.body.agent.systemPrompt).toBe('Be helpful');

    const listed = await request(app).get('/api/agents').set(alice);
    expect(listed.body.items).toHaveLength(1);

    expect((await request(app).delete(`/api/agents/${id}`).set(alice)).status).toBe(204);
    expect((await request(app).get(`/api/agents/${id}`).set(alice)).status).toBe(404);
  });

  it('rejects unknown tools and invalid input', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set(alice)
      .send({ ...agentBody, tools: ['rm_rf'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ignores an ownerId in the body', async () => {
    const bob = await createUser('bob');
    const res = await request(app)
      .post('/api/agents')
      .set(alice)
      .send({ ...agentBody, ownerId: bob._id.toString() });
    const stored = await Agent.findById(res.body.agent.id);
    expect(stored?.ownerId.toString()).not.toBe(bob._id.toString());
  });

  it('refuses MCP servers the user does not own', async () => {
    const theirs = await request(app).post('/api/mcp-servers').set(mallory).send(mcpBody);
    const res = await request(app)
      .post('/api/agents')
      .set(alice)
      .send({ ...agentBody, mcpServerIds: [theirs.body.server.id] });
    expect(res.status).toBe(400);
  });

  it('keeps conversations as plain chats when the agent is deleted', async () => {
    const agent = await request(app).post('/api/agents').set(alice).send(agentBody);
    const conversation = await request(app)
      .post('/api/conversations')
      .set(alice)
      .send({ agentId: agent.body.agent.id });
    await request(app).delete(`/api/agents/${agent.body.agent.id}`).set(alice);
    const stored = await Conversation.findById(conversation.body.conversation.id);
    expect(stored).not.toBeNull();
    expect(stored?.agentId).toBeUndefined();
  });
});

describe('ownership', () => {
  it.each([
    ['/api/agents', agentBody, 'agent'],
    ['/api/mcp-servers', mcpBody, 'server'],
    ['/api/workflows', { name: 'Flow' }, 'workflow'],
    ['/api/conversations', {}, 'conversation'],
  ])('hides %s from other users', async (path, body, key) => {
    const created = await request(app).post(path).set(alice).send(body);
    expect(created.status).toBe(201);
    const url = `${path}/${created.body[key].id}`;

    expect((await request(app).get(url).set(mallory)).status).toBe(404);
    expect(
      (await request(app).patch(url).set(mallory).send({ name: 'x', title: 'x' })).status,
    ).toBe(404);
    expect((await request(app).delete(url).set(mallory)).status).toBe(404);
    expect((await request(app).get(path).set(mallory)).body.items).toHaveLength(0);
    expect((await request(app).get(url).set(alice)).status).toBe(200);
  });

  it('requires auth on every resource route', async () => {
    for (const path of [
      '/api/agents',
      '/api/mcp-servers',
      '/api/workflows',
      '/api/conversations',
    ]) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it('rejects malformed ids with 400', async () => {
    const res = await request(app).get('/api/agents/not-an-id').set(alice);
    expect(res.status).toBe(400);
  });

  it('hides messages of another user’s conversation', async () => {
    const created = await request(app).post('/api/conversations').set(alice).send({});
    const url = `/api/conversations/${created.body.conversation.id}/messages`;
    expect((await request(app).get(url).set(mallory)).status).toBe(404);
  });
});

describe('conversations', () => {
  it('returns messages in order and removes them with the conversation', async () => {
    const created = await request(app)
      .post('/api/conversations')
      .set(alice)
      .send({ title: 'Plans' });
    const { id } = created.body.conversation;
    await Message.create({ conversationId: id, role: 'user', content: 'first' });
    await Message.create({ conversationId: id, role: 'assistant', content: 'second' });

    const messages = await request(app).get(`/api/conversations/${id}/messages`).set(alice);
    expect(messages.body.items.map((m: { content: string }) => m.content)).toEqual([
      'first',
      'second',
    ]);

    await request(app).delete(`/api/conversations/${id}`).set(alice);
    expect(await Message.countDocuments({ conversationId: id })).toBe(0);
  });

  it('refuses another user’s agent', async () => {
    const agent = await request(app).post('/api/agents').set(mallory).send(agentBody);
    const res = await request(app)
      .post('/api/conversations')
      .set(alice)
      .send({ agentId: agent.body.agent.id });
    expect(res.status).toBe(400);
  });
});

describe('mcp servers', () => {
  it('encrypts credentials and never returns them', async () => {
    const res = await request(app)
      .post('/api/mcp-servers')
      .set(alice)
      .send({ ...mcpBody, auth: { bearerToken: 'top-secret' } });
    expect(res.status).toBe(201);
    expect(res.body.server.hasAuth).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('top-secret');
    expect(res.body.server.encryptedAuth).toBeUndefined();

    const stored = await McpServer.findById(res.body.server.id);
    expect(stored?.encryptedAuth).toBeTruthy();
    expect(stored?.encryptedAuth).not.toContain('top-secret');
    expect(decryptJson(stored?.encryptedAuth ?? '')).toEqual({ bearerToken: 'top-secret' });
  });

  it('removes credentials when auth is null and keeps them when omitted', async () => {
    const { body } = await request(app)
      .post('/api/mcp-servers')
      .set(alice)
      .send({ ...mcpBody, auth: { bearerToken: 'x' } });
    const url = `/api/mcp-servers/${body.server.id}`;

    const renamed = await request(app).patch(url).set(alice).send({ name: 'Renamed' });
    expect(renamed.body.server.hasAuth).toBe(true);

    const cleared = await request(app).patch(url).set(alice).send({ auth: null });
    expect(cleared.body.server.hasAuth).toBe(false);
  });

  it('refuses stdio servers unless the deployment allows them', async () => {
    const res = await request(app)
      .post('/api/mcp-servers')
      .set(alice)
      .send({ name: 'Local', transport: 'stdio', command: 'rm', args: ['-rf', '/'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MCP_STDIO_DISABLED');
  });

  it('requires a url for http transports and rejects other schemes', async () => {
    const missing = await request(app)
      .post('/api/mcp-servers')
      .set(alice)
      .send({ name: 'x', transport: 'sse' });
    expect(missing.status).toBe(400);

    const scheme = await request(app)
      .post('/api/mcp-servers')
      .set(alice)
      .send({ name: 'x', transport: 'sse', url: 'file:///etc/passwd' });
    expect(scheme.status).toBe(400);
  });

  it('detaches a deleted server from agents', async () => {
    const server = await request(app).post('/api/mcp-servers').set(alice).send(mcpBody);
    const agent = await request(app)
      .post('/api/agents')
      .set(alice)
      .send({ ...agentBody, mcpServerIds: [server.body.server.id] });
    await request(app).delete(`/api/mcp-servers/${server.body.server.id}`).set(alice);
    const stored = await Agent.findById(agent.body.agent.id);
    expect(stored?.mcpServerIds).toHaveLength(0);
  });
});

describe('workflows', () => {
  const nodes = [
    { id: 'a', type: 'llm', config: { prompt: 'hi' }, position: { x: 1, y: 2 } },
    { id: 'b', type: 'human_approval' },
  ];

  it('stores nodes and edges', async () => {
    const res = await request(app)
      .post('/api/workflows')
      .set(alice)
      .send({
        name: 'Flow',
        nodes,
        edges: [{ id: 'e', source: 'a', target: 'b' }],
      });
    expect(res.status).toBe(201);
    expect(res.body.workflow.nodes[0].config).toEqual({ prompt: 'hi' });
    expect(res.body.workflow.edges).toHaveLength(1);
  });

  it('rejects duplicate node ids, dangling edges and unknown node types', async () => {
    const send = (body: object) =>
      request(app)
        .post('/api/workflows')
        .set(alice)
        .send({ name: 'Flow', ...body });
    expect((await send({ nodes: [nodes[0], nodes[0]] })).status).toBe(400);
    expect((await send({ nodes, edges: [{ id: 'e', source: 'a', target: 'zzz' }] })).status).toBe(
      400,
    );
    expect((await send({ nodes: [{ id: 'x', type: 'exec_shell' }] })).status).toBe(400);
  });
});

describe('long conversations', () => {
  it('returns the newest page of messages, oldest first', async () => {
    const created = await request(app).post('/api/conversations').set(alice).send({});
    const { id } = created.body.conversation;
    for (const content of ['one', 'two', 'three']) {
      await Message.create({ conversationId: id, role: 'user', content });
    }
    const res = await request(app).get(`/api/conversations/${id}/messages?limit=2`).set(alice);
    expect(res.body.items.map((m: { content: string }) => m.content)).toEqual(['two', 'three']);
  });
});
