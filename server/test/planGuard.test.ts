import type { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { UsageCounter, User } from '../src/models/index.js';
import { PLAN_LIMITS } from '../src/services/billing/plans.js';
import {
  currentPeriod,
  getUsageSummary,
  refundUsage,
  reserveUsage,
} from '../src/services/billing/usage.js';
import type * as LlmModule from '../src/services/llm/llm.js';
import { useAiTestEnvironment } from './helpers/aiEnv.js';
import { authHeader, createUser } from './helpers/auth.js';
import type { ScriptedReply } from './helpers/scriptedModel.js';
import { ScriptedChatModel } from './helpers/scriptedModel.js';
import { parseSse } from './helpers/sse.js';

const llm = vi.hoisted(() => ({ next: undefined as unknown, failWith: undefined as unknown }));

vi.mock('../src/config/firebase.js', async () => {
  const { fakeVerifyFirebaseToken } = await import('./helpers/auth.js');
  return { verifyFirebaseToken: fakeVerifyFirebaseToken };
});

vi.mock('../src/services/llm/llm.js', async (importOriginal) => ({
  ...(await importOriginal<typeof LlmModule>()),
  createChatModel: vi.fn(async () => {
    if (llm.failWith) throw llm.failWith;
    return llm.next;
  }),
}));

useAiTestEnvironment();

const app = createApp();
const alice = authHeader('alice');
let aliceId: Types.ObjectId;

function script(...replies: ScriptedReply[]): void {
  llm.next = new ScriptedChatModel(replies);
  llm.failWith = undefined;
}

async function setUsage(messages: number, runs = 0): Promise<void> {
  await UsageCounter.create({ userId: aliceId, period: currentPeriod(), messages, runs });
}

async function messagesUsed(): Promise<number> {
  return (await UsageCounter.findOne({ userId: aliceId }))?.messages ?? 0;
}

const agentBody = { name: 'A', model: { provider: 'openai', name: 'x' } };

beforeEach(async () => {
  aliceId = (await createUser('alice'))._id;
});

describe('currentPeriod', () => {
  it('formats the UTC month', () => {
    expect(currentPeriod(new Date('2026-03-31T23:59:59Z'))).toBe('2026-03');
    expect(currentPeriod(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01');
  });
});

describe('reserveUsage', () => {
  it('counts up to the limit, then refuses with a clear code', async () => {
    await setUsage(PLAN_LIMITS.free.messagesPerMonth - 1);
    await expect(reserveUsage(aliceId, 'free', 'messages')).resolves.toBe(currentPeriod());
    await expect(reserveUsage(aliceId, 'free', 'messages')).rejects.toMatchObject({
      status: 402,
      code: 'PLAN_LIMIT_REACHED',
    });
    expect(await messagesUsed()).toBe(PLAN_LIMITS.free.messagesPerMonth);
  });

  it('cannot be pushed over the limit by parallel requests', async () => {
    const attempts = PLAN_LIMITS.free.messagesPerMonth + 25;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => reserveUsage(aliceId, 'free', 'messages')),
    );
    const accepted = results.filter((result) => result.status === 'fulfilled');
    expect(accepted).toHaveLength(PLAN_LIMITS.free.messagesPerMonth);
    expect(await messagesUsed()).toBe(PLAN_LIMITS.free.messagesPerMonth);
  });

  it('counts each user and each period apart', async () => {
    const bob = await createUser('bob');
    await UsageCounter.create({
      userId: aliceId,
      period: '2020-01',
      messages: PLAN_LIMITS.free.messagesPerMonth,
    });
    await reserveUsage(aliceId, 'free', 'messages');
    await reserveUsage(bob._id, 'free', 'messages');
    expect(await messagesUsed()).toBeGreaterThan(0);
    expect(await UsageCounter.countDocuments()).toBe(3);
  });

  it('gives Pro its higher limit', async () => {
    await setUsage(PLAN_LIMITS.free.messagesPerMonth);
    await expect(reserveUsage(aliceId, 'pro', 'messages')).resolves.toBeTruthy();
  });
});

describe('refundUsage', () => {
  it('never goes below zero', async () => {
    await setUsage(0);
    await refundUsage(aliceId, currentPeriod(), 'messages');
    expect(await messagesUsed()).toBe(0);
  });
});

describe('message limits', () => {
  it('returns 402 before calling the model when the month is used up', async () => {
    await setUsage(PLAN_LIMITS.free.messagesPerMonth);
    script({ text: 'never' });

    const res = await request(app).post('/api/chat').set(alice).send({ message: 'hi' });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { resource: 'messages', plan: 'free' },
    });
    expect((llm.next as ScriptedChatModel).seen).toHaveLength(0);
  });

  it('counts a completed message', async () => {
    script({ text: 'hello' });
    await request(app).post('/api/chat').set(alice).send({ message: 'hi' }).buffer(true);
    expect(await messagesUsed()).toBe(1);
  });

  it('refunds when the model fails partway', async () => {
    script({ error: Object.assign(new Error('nope'), { status: 500 }) });
    const res = await request(app)
      .post('/api/chat')
      .set(alice)
      .send({ message: 'hi' })
      .buffer(true);
    expect(parseSse(res.text).at(-1)?.event).toBe('error');
    await vi.waitFor(async () => expect(await messagesUsed()).toBe(0));
  });

  it('refunds when the request fails before streaming', async () => {
    llm.failWith = Object.assign(new Error('No key'), { status: 503 });
    const res = await request(app).post('/api/chat').set(alice).send({ message: 'hi' });
    expect(res.status).toBe(500);
    await vi.waitFor(async () => expect(await messagesUsed()).toBe(0));
  });

  it('does not charge for invalid input', async () => {
    const res = await request(app).post('/api/chat').set(alice).send({ message: '' });
    expect(res.status).toBe(400);
    expect(await messagesUsed()).toBe(0);
  });

  it('applies to agent chats too', async () => {
    script({ text: 'x' });
    const agent = await request(app).post('/api/agents').set(alice).send(agentBody);
    await setUsage(PLAN_LIMITS.free.messagesPerMonth);
    const res = await request(app)
      .post(`/api/agents/${agent.body.agent.id}/chat`)
      .set(alice)
      .send({ message: 'hi' });
    expect(res.status).toBe(402);
  });
});

describe('run limits', () => {
  const nodes = [
    { id: 'a', type: 'tool', config: { tool: 'calculator', args: { expression: '1' } } },
  ];

  it('returns 402 when the month’s runs are used up', async () => {
    const { body } = await request(app)
      .post('/api/workflows')
      .set(alice)
      .send({ name: 'F', nodes });
    await setUsage(0, PLAN_LIMITS.free.runsPerMonth);
    const res = await request(app)
      .post(`/api/workflows/${body.workflow.id}/run`)
      .set(alice)
      .send({});
    expect(res.status).toBe(402);
    expect(res.body.error.details.resource).toBe('runs');
  });

  it('refunds a run that fails validation', async () => {
    const { body } = await request(app).post('/api/workflows').set(alice).send({ name: 'Empty' });
    const res = await request(app)
      .post(`/api/workflows/${body.workflow.id}/run`)
      .set(alice)
      .send({});
    expect(res.status).toBe(400);
    await vi.waitFor(async () => {
      expect((await UsageCounter.findOne({ userId: aliceId }))?.runs).toBe(0);
    });
  });
});

describe('resource limits', () => {
  it.each([
    ['/api/agents', agentBody, PLAN_LIMITS.free.agents, 'agents'],
    [
      '/api/mcp-servers',
      { name: 'M', transport: 'sse', url: 'https://mcp.example.com' },
      PLAN_LIMITS.free.mcpServers,
      'mcpServers',
    ],
    ['/api/workflows', { name: 'W' }, PLAN_LIMITS.free.workflows, 'workflows'],
  ])('stops creating %s at the free limit', async (path, body, limit, resource) => {
    for (let index = 0; index < limit; index += 1) {
      const res = await request(app).post(path).set(alice).send(body);
      expect(res.status).toBe(201);
    }
    const blocked = await request(app).post(path).set(alice).send(body);
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { resource, limit },
    });
  });

  it('lets a Pro user go past the free limit', async () => {
    await User.updateOne({ _id: aliceId }, { plan: 'pro' });
    for (let index = 0; index <= PLAN_LIMITS.free.agents; index += 1) {
      const res = await request(app).post('/api/agents').set(alice).send(agentBody);
      expect(res.status).toBe(201);
    }
  });

  it('frees a slot when something is deleted', async () => {
    const created = [];
    for (let index = 0; index < PLAN_LIMITS.free.agents; index += 1) {
      created.push(await request(app).post('/api/agents').set(alice).send(agentBody));
    }
    await request(app).delete(`/api/agents/${created[0]?.body.agent.id}`).set(alice);
    const res = await request(app).post('/api/agents').set(alice).send(agentBody);
    expect(res.status).toBe(201);
  });

  it('counts only your own resources', async () => {
    const mallory = authHeader('mallory');
    await createUser('mallory');
    await request(app).post('/api/mcp-servers').set(mallory).send({
      name: 'M',
      transport: 'sse',
      url: 'https://mcp.example.com',
    });
    const res = await request(app).post('/api/mcp-servers').set(alice).send({
      name: 'M',
      transport: 'sse',
      url: 'https://mcp.example.com',
    });
    expect(res.status).toBe(201);
  });
});

describe('GET /api/me', () => {
  it('reports usage, limits and no subscription', async () => {
    await setUsage(7, 3);
    await request(app).post('/api/agents').set(alice).send(agentBody);

    const res = await request(app).get('/api/me').set(alice);

    expect(res.body.usage).toMatchObject({ messages: 7, runs: 3, agents: 1, mcpServers: 0 });
    expect(res.body.limits).toEqual(PLAN_LIMITS.free);
    expect(res.body.subscription).toBeNull();
  });

  it('summarizes a user with no activity as zeros', async () => {
    expect(await getUsageSummary(aliceId)).toMatchObject({ messages: 0, runs: 0, agents: 0 });
  });
});
