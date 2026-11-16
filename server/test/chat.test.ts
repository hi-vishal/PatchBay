import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type * as LlmModule from '../src/services/llm/llm.js';
import { env } from '../src/config/env.js';
import { Conversation, Message } from '../src/models/index.js';
import {
  closeCheckpointer,
  getCheckpointer,
  initCheckpointer,
} from '../src/services/graphs/checkpointer.js';
import { authHeader, createUser } from './helpers/auth.js';
import { ScriptedChatModel } from './helpers/scriptedModel.js';
import type { ScriptedReply } from './helpers/scriptedModel.js';
import { parseSse, tokensOf } from './helpers/sse.js';

const llm = vi.hoisted(() => ({ next: undefined as unknown }));

vi.mock('../src/config/firebase.js', async () => {
  const { fakeVerifyFirebaseToken } = await import('./helpers/auth.js');
  return { verifyFirebaseToken: fakeVerifyFirebaseToken };
});

vi.mock('../src/services/llm/llm.js', async (importOriginal) => ({
  ...(await importOriginal<typeof LlmModule>()),
  createChatModel: vi.fn(async () => llm.next),
}));

const app = createApp();
const alice = authHeader('alice');
let mongo: MongoMemoryServer;

function script(...replies: ScriptedReply[]): ScriptedChatModel {
  const model = new ScriptedChatModel(replies);
  llm.next = model;
  return model;
}

const postChat = (body: object, auth = alice) =>
  request(app).post('/api/chat').set(auth).send(body).buffer(true);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  await initCheckpointer(mongo.getUri());
});

beforeEach(async () => {
  await createUser('alice');
  await createUser('mallory');
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
});

afterAll(async () => {
  await closeCheckpointer();
  await mongoose.disconnect();
  await mongo.stop();
});

describe('POST /api/chat', () => {
  it('requires auth and a message', async () => {
    expect((await request(app).post('/api/chat').send({ message: 'x' })).status).toBe(401);
    const empty = await request(app).post('/api/chat').set(alice).send({ message: '   ' });
    expect(empty.status).toBe(400);
  });

  it('streams tokens and done over SSE, and saves both messages', async () => {
    script({ text: 'Hello from the model' });

    const res = await postChat({ message: 'Hi there' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const conversationId = res.headers['x-conversation-id'] as string;
    expect(conversationId).toBeTruthy();

    const events = parseSse(res.text);
    expect(tokensOf(events)).toBe('Hello from the model');
    expect(events.at(-1)).toMatchObject({
      event: 'done',
      data: { conversationId, usage: { totalTokens: 15 } },
    });

    const conversation = await Conversation.findById(conversationId);
    expect(conversation?.title).toBe('Hi there');

    const saved = await Message.find({ conversationId }).sort({ createdAt: 1 });
    expect(saved.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Hi there'],
      ['assistant', 'Hello from the model'],
    ]);
    expect(saved[1]?.usage?.totalTokens).toBe(15);
  });

  it('keeps memory across turns through the MongoDB checkpointer', async () => {
    const model = script({ text: 'Nice to meet you' }, { text: 'You are Alice' });

    const first = await postChat({ message: 'I am Alice' });
    const conversationId = first.headers['x-conversation-id'];
    await postChat({ message: 'Who am I?', conversationId });

    expect(model.seen[1]?.map((message) => message.text)).toEqual([
      'I am Alice',
      'Nice to meet you',
      'Who am I?',
    ]);
    const conversation = await Conversation.findById(conversationId);
    const checkpoint = await getCheckpointer().getTuple({
      configurable: { thread_id: conversation?.threadId },
    });
    expect(checkpoint).toBeDefined();
  });

  it('removes checkpoints when the conversation is deleted', async () => {
    script({ text: 'hello' });
    const res = await postChat({ message: 'hi' });
    const conversationId = res.headers['x-conversation-id'] as string;
    const conversation = await Conversation.findById(conversationId);
    const config = { configurable: { thread_id: conversation?.threadId } };
    expect(await getCheckpointer().getTuple(config)).toBeDefined();

    await request(app).delete(`/api/conversations/${conversationId}`).set(alice);

    expect(await getCheckpointer().getTuple(config)).toBeUndefined();
  });

  it('refuses to continue another user’s conversation', async () => {
    script({ text: 'hello' });
    const res = await postChat({ message: 'private' });

    script({ text: 'leak' });
    const attack = await postChat(
      { message: 'read this', conversationId: res.headers['x-conversation-id'] },
      authHeader('mallory'),
    );
    expect(attack.status).toBe(404);
  });

  it('emits a safe error event when the provider fails', async () => {
    script({
      error: Object.assign(new Error('Incorrect API key provided: sk-abc123'), { status: 401 }),
    });

    const res = await postChat({ message: 'hi' });

    const events = parseSse(res.text);
    expect(events.at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'LLM_AUTH_FAILED' },
    });
    expect(res.text).not.toContain('sk-abc123');
  });

  it('reports a refusal instead of an empty success', async () => {
    script({ stopReason: 'refusal' });
    const res = await postChat({ message: 'hi' });
    expect(parseSse(res.text).at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'MODEL_REFUSED' },
    });
  });
});

describe('retrying a reply', () => {
  const savedMessages = async (conversationId: string | undefined) =>
    (await Message.find({ conversationId }).sort({ createdAt: 1, _id: 1 })).map((message) => [
      message.role,
      message.content,
    ]);

  it('replaces a reply that failed partway, without repeating the question', async () => {
    const model = script(
      { text: 'Half an', errorAfterText: Object.assign(new Error('busy'), { status: 429 }) },
      { text: 'A full answer' },
    );

    const failed = await postChat({ message: 'Question' });
    const conversationId = failed.headers['x-conversation-id'];
    expect(parseSse(failed.text).at(-1)?.event).toBe('error');
    expect(await savedMessages(conversationId)).toEqual([
      ['user', 'Question'],
      ['assistant', 'Half an'],
    ]);

    const retried = await postChat({ message: 'Question', conversationId, retry: true });

    expect(tokensOf(parseSse(retried.text))).toBe('A full answer');
    expect(parseSse(retried.text).at(-1)?.event).toBe('done');
    expect(await savedMessages(conversationId)).toEqual([
      ['user', 'Question'],
      ['assistant', 'A full answer'],
    ]);
    expect(model.seen[1]?.map((message) => message.text)).toEqual(['Question']);
  });

  it('keeps the thread usable after a retry', async () => {
    const model = script(
      { error: Object.assign(new Error('busy'), { status: 429 }) },
      { text: 'First answer' },
      { text: 'Second answer' },
    );

    const failed = await postChat({ message: 'One' });
    const conversationId = failed.headers['x-conversation-id'];
    await postChat({ message: 'One', conversationId, retry: true });
    await postChat({ message: 'Two', conversationId });

    expect(model.seen[2]?.map((message) => message.text)).toEqual(['One', 'First answer', 'Two']);
  });

  it('saves the message as new when the earlier attempt never reached the server', async () => {
    const model = script({ text: 'First' }, { text: 'Second' });
    const first = await postChat({ message: 'One' });
    const conversationId = first.headers['x-conversation-id'];

    await postChat({ message: 'Two', conversationId, retry: true });

    expect(await savedMessages(conversationId)).toEqual([
      ['user', 'One'],
      ['assistant', 'First'],
      ['user', 'Two'],
      ['assistant', 'Second'],
    ]);
    expect(model.seen[1]?.map((message) => message.text)).toEqual(['One', 'First', 'Two']);
  });

  it('starts a new chat when a retry has no conversation yet', async () => {
    script({ text: 'Hello' });
    const res = await postChat({ message: 'Hi', retry: true });
    expect(await savedMessages(res.headers['x-conversation-id'])).toEqual([
      ['user', 'Hi'],
      ['assistant', 'Hello'],
    ]);
  });

  it('refuses to retry another user’s conversation and leaves it untouched', async () => {
    script({ text: 'Half', errorAfterText: Object.assign(new Error('busy'), { status: 429 }) });
    const failed = await postChat({ message: 'Private' });
    const conversationId = failed.headers['x-conversation-id'];

    script({ text: 'leak' });
    const attack = await postChat(
      { message: 'Private', conversationId, retry: true },
      authHeader('mallory'),
    );

    expect(attack.status).toBe(404);
    expect(await savedMessages(conversationId)).toEqual([
      ['user', 'Private'],
      ['assistant', 'Half'],
    ]);
  });

  it('keeps a reply stopped by the client, and can retry it over real HTTP', async () => {
    const model = script(
      { text: 'one two three four five six seven eight nine ten', delayMs: 40 },
      { text: 'A full answer' },
    );
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;

    try {
      const controller = new AbortController();
      const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: 'POST',
        headers: { ...alice, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Count' }),
        signal: controller.signal,
      });
      const conversationId = response.headers.get('x-conversation-id') as string;
      const reader = response.body?.getReader();
      let received = '';
      while (!received.includes('event: token')) {
        const { value } = (await reader?.read()) ?? {};
        received += new TextDecoder().decode(value);
      }
      controller.abort();

      await vi.waitFor(async () => {
        expect(await Message.countDocuments({ conversationId, role: 'assistant' })).toBe(1);
      });
      const stopped = await savedMessages(conversationId);
      expect(String(stopped[1]?.[1]).startsWith('one')).toBe(true);
      expect(stopped[1]?.[1]).not.toContain('ten');

      await postChat({ message: 'Count', conversationId, retry: true });

      expect(await savedMessages(conversationId)).toEqual([
        ['user', 'Count'],
        ['assistant', 'A full answer'],
      ]);
      expect(model.seen[1]?.map((message) => message.text)).toEqual(['Count']);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('GET /api/llm/providers', () => {
  it('reports which providers have keys, without exposing them', async () => {
    env.ANTHROPIC_API_KEY = 'sk-ant-test-secret';
    const res = await request(app).get('/api/llm/providers').set(alice);
    env.ANTHROPIC_API_KEY = undefined;

    expect(res.status).toBe(200);
    const anthropic = res.body.items.find(
      (item: { provider: string }) => item.provider === 'anthropic',
    );
    expect(anthropic.configured).toBe(true);
    expect(res.body.default).toEqual({ provider: 'anthropic', name: 'claude-opus-5-5' });
    expect(JSON.stringify(res.body)).not.toContain('sk-ant-test-secret');
  });
});
