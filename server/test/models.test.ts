import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  Agent,
  Conversation,
  McpServer,
  Message,
  Run,
  Subscription,
  UsageCounter,
  User,
  WebhookEvent,
  Workflow,
} from '../src/models/index.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase();

const ownerId = new Types.ObjectId();

describe('models', () => {
  it('defaults a new user to the free plan and enforces a unique firebaseUid', async () => {
    const user = await User.create({ firebaseUid: 'uid-1', email: 'A@Example.com' });
    expect(user.plan).toBe('free');
    expect(user.email).toBe('a@example.com');
    await expect(User.create({ firebaseUid: 'uid-1' })).rejects.toMatchObject({ code: 11000 });
  });

  it('stores the agent model config and serializes id without _id', async () => {
    const agent = await Agent.create({
      ownerId,
      name: 'Researcher',
      model: { provider: 'openai', name: 'gpt-5.2', temperature: 0.2 },
    });
    expect(agent.model.provider).toBe('openai');
    const json = agent.toJSON() as unknown as Record<string, unknown>;
    expect(json.id).toBe(agent._id.toString());
    expect(json._id).toBeUndefined();
    expect(json.__v).toBeUndefined();
    expect(json.model).toMatchObject({ provider: 'openai', name: 'gpt-5.2', temperature: 0.2 });
  });

  it('rejects an unknown LLM provider', async () => {
    await expect(
      Agent.create({ ownerId, name: 'x', model: { provider: 'nope' as 'openai', name: 'y' } }),
    ).rejects.toThrow(/provider/);
  });

  it('never serializes MCP credentials', async () => {
    const server = await McpServer.create({
      ownerId,
      name: 'tools',
      transport: 'streamable_http',
      url: 'https://mcp.example.com',
      encryptedAuth: 'ciphertext',
    });
    const json = server.toJSON() as unknown as Record<string, unknown>;
    expect(json.encryptedAuth).toBeUndefined();
    expect(json.hasAuth).toBe(true);
    expect(JSON.stringify(server)).not.toContain('ciphertext');
  });

  it('gives each conversation its own threadId', async () => {
    const first = await Conversation.create({ ownerId });
    const second = await Conversation.create({ ownerId });
    expect(first.threadId).toBeTruthy();
    expect(first.threadId).not.toBe(second.threadId);
    expect(first.title).toBe('New chat');
  });

  it('stores tool calls on messages', async () => {
    const message = await Message.create({
      conversationId: new Types.ObjectId(),
      role: 'assistant',
      content: 'hi',
      toolCalls: [{ id: 'c1', name: 'calculator', args: { expression: '1+1' }, output: '2' }],
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    });
    expect(message.toolCalls[0]?.name).toBe('calculator');
    expect(message.usage?.totalTokens).toBe(7);
  });

  it('keeps workflow node ids and condition handles', async () => {
    const workflow = await Workflow.create({
      ownerId,
      name: 'Flow',
      nodes: [{ id: 'a', type: 'condition', config: { expression: 'x' } }],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'true' }],
    });
    const json = workflow.toJSON() as unknown as {
      nodes: { id: string; config: unknown }[];
      edges: { sourceHandle: string }[];
      trigger: { type: string };
    };
    expect(json.nodes[0]).toMatchObject({ id: 'a', config: { expression: 'x' } });
    expect(json.edges[0]?.sourceHandle).toBe('true');
    expect(json.trigger.type).toBe('manual');
  });

  it('requires a run to target exactly one of workflow or agent', async () => {
    await expect(Run.create({ ownerId })).rejects.toThrow(/exactly one/);
    await expect(
      Run.create({ ownerId, workflowId: new Types.ObjectId(), agentId: new Types.ObjectId() }),
    ).rejects.toThrow(/exactly one/);
    const run = await Run.create({ ownerId, workflowId: new Types.ObjectId() });
    expect(run.status).toBe('pending');
    expect(run.threadId).toBeTruthy();
  });

  it('allows one usage counter per user per period', async () => {
    const userId = new Types.ObjectId();
    await UsageCounter.create({ userId, period: '2026-11' });
    await UsageCounter.create({ userId, period: '2026-12' });
    await expect(UsageCounter.create({ userId, period: '2026-11' })).rejects.toMatchObject({
      code: 11000,
    });
    await expect(UsageCounter.create({ userId, period: 'nov' })).rejects.toThrow(/period/);
  });

  it('enforces unique webhook events and subscription ids', async () => {
    await WebhookEvent.create({ eventId: 'evt_1', type: 'subscription.charged' });
    await expect(
      WebhookEvent.create({ eventId: 'evt_1', type: 'subscription.charged' }),
    ).rejects.toMatchObject({ code: 11000 });

    const base = { userId: new Types.ObjectId(), planId: 'plan_1' };
    await Subscription.create({ ...base, razorpaySubscriptionId: 'sub_1' });
    await expect(
      Subscription.create({ ...base, razorpaySubscriptionId: 'sub_1' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('creates owner lookup indexes', async () => {
    for (const collection of [Agent, McpServer, Conversation, Workflow, Run]) {
      const indexes = await collection.collection.indexes();
      expect(indexes.some((index) => 'ownerId' in index.key)).toBe(true);
    }
  });
});
