import { SystemMessage, ToolMessage } from '@langchain/core/messages';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { Conversation, McpServer, Message, Run } from '../src/models/index.js';
import type * as LlmModule from '../src/services/llm/llm.js';
import { createChatModel } from '../src/services/llm/llm.js';
import { AppError } from '../src/utils/errors.js';
import { useAiTestEnvironment } from './helpers/aiEnv.js';
import { authHeader, createUser } from './helpers/auth.js';
import type { TestMcpServer } from './helpers/mcpServer.js';
import { startTestMcpServer } from './helpers/mcpServer.js';
import type { ScriptedReply } from './helpers/scriptedModel.js';
import { ScriptedChatModel } from './helpers/scriptedModel.js';
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

useAiTestEnvironment();

const app = createApp();
const alice = authHeader('alice');
let live: TestMcpServer;

function script(...replies: ScriptedReply[]): ScriptedChatModel {
  const model = new ScriptedChatModel(replies);
  llm.next = model;
  return model;
}

async function createAgent(fields: object = {}): Promise<string> {
  const res = await request(app)
    .post('/api/agents')
    .set(alice)
    .send({
      name: 'Helper',
      systemPrompt: 'You are Helper',
      model: { provider: 'openai', name: 'x' },
      ...fields,
    });
  expect(res.status).toBe(201);
  return res.body.agent.id;
}

async function createMcp(url = live.url): Promise<{ id: string; prefix: string }> {
  const res = await request(app)
    .post('/api/mcp-servers')
    .set(alice)
    .send({ name: 'Math', transport: 'streamable_http', url });
  const { id } = res.body.server as { id: string };
  return { id, prefix: `math_${id.slice(-6)}` };
}

const chat = (agentId: string, body: object) =>
  request(app).post(`/api/agents/${agentId}/chat`).set(alice).send(body).buffer(true);

beforeAll(async () => {
  live = await startTestMcpServer();
});

afterAll(async () => {
  await live.stop();
});

beforeEach(async () => {
  env.MCP_ALLOW_PRIVATE_NETWORKS = true;
  await createUser('alice');
  await createUser('mallory');
});

afterEach(() => {
  env.MCP_ALLOW_PRIVATE_NETWORKS = false;
});

describe('POST /api/agents/:id/chat', () => {
  it('injects the system prompt and streams the reply', async () => {
    const model = script({ text: 'Hi, I am Helper' });
    const id = await createAgent();

    const res = await chat(id, { message: 'Who are you?' });

    const events = parseSse(res.text);
    expect(tokensOf(events)).toBe('Hi, I am Helper');
    expect(events.at(-1)?.event).toBe('done');
    expect(SystemMessage.isInstance(model.seen[0]?.[0])).toBe(true);
    expect(model.seen[0]?.[0]?.text).toBe('You are Helper');

    const conversation = await Conversation.findById(res.headers['x-conversation-id']);
    expect(conversation?.agentId?.toString()).toBe(id);
  });

  it('runs built-in tools and saves them on the message and the run', async () => {
    script(
      { toolCalls: [{ id: 'c1', name: 'calculator', args: { expression: '6 * 7' } }] },
      { text: 'It is 42' },
    );
    const id = await createAgent({ tools: ['calculator'] });

    const res = await chat(id, { message: '6 times 7?' });

    const events = parseSse(res.text);
    expect(events.map((item) => item.event)).toContain('tool_start');
    expect(events.find((item) => item.event === 'tool_end')?.data).toMatchObject({
      name: 'calculator',
      output: '42',
      isError: false,
    });

    const saved = await Message.findOne({ role: 'assistant' });
    expect(saved?.toolCalls[0]).toMatchObject({ name: 'calculator', output: '42', isError: false });

    const run = await Run.findOne({ agentId: id });
    expect(run).toMatchObject({ status: 'succeeded', output: 'It is 42', input: '6 times 7?' });
    expect(run?.steps[0]).toMatchObject({ label: 'calculator', status: 'succeeded' });
    expect(run?.endedAt).toBeInstanceOf(Date);
  });

  it('calls a tool on a real MCP server', async () => {
    const mcp = await createMcp();
    script(
      { toolCalls: [{ id: 'c1', name: `${mcp.prefix}_add`, args: { a: 40, b: 2 } }] },
      { text: 'The sum is 42' },
    );
    const id = await createAgent({ mcpServerIds: [mcp.id] });

    const res = await chat(id, { message: 'add 40 and 2' });

    const end = parseSse(res.text).find((item) => item.event === 'tool_end');
    expect(end?.data).toMatchObject({ name: `${mcp.prefix}_add`, isError: false });
    expect(JSON.stringify(end?.data.output)).toContain('42');
    expect(tokensOf(parseSse(res.text))).toBe('The sum is 42');
  });

  it('surfaces a failing MCP tool as a tool error and keeps going', async () => {
    const mcp = await createMcp();
    script(
      { toolCalls: [{ id: 'c1', name: `${mcp.prefix}_explode`, args: {} }] },
      { text: 'That tool failed' },
    );
    const id = await createAgent({ mcpServerIds: [mcp.id] });

    const events = parseSse((await chat(id, { message: 'blow up' })).text);

    expect(events.find((item) => item.event === 'tool_end')?.data).toMatchObject({ isError: true });
    expect(events.at(-1)?.event).toBe('done');
  });

  it('surfaces a dead MCP server as a tool error and still answers', async () => {
    const dead = await createMcp('http://127.0.0.1:9/mcp');
    const model = script({ text: 'I could not reach that server' });
    const id = await createAgent({ mcpServerIds: [dead.id] });

    const events = parseSse((await chat(id, { message: 'hello' })).text);

    const end = events.find((item) => item.event === 'tool_end');
    expect(end?.data).toMatchObject({ name: 'mcp:Math', isError: true });
    expect(events.at(-1)?.event).toBe('done');
    expect(tokensOf(events)).toBe('I could not reach that server');
    expect(model.seen[0]?.[0]?.text).toContain('unavailable right now: Math');

    const run = await Run.findOne({ agentId: id });
    expect(run?.status).toBe('succeeded');
    expect(run?.steps[0]).toMatchObject({ label: 'mcp:Math', status: 'failed' });
  });

  it('skips disabled MCP servers', async () => {
    const mcp = await createMcp('http://127.0.0.1:9/mcp');
    await McpServer.updateOne({ _id: mcp.id }, { enabled: false });
    script({ text: 'ok' });
    const id = await createAgent({ mcpServerIds: [mcp.id] });

    const events = parseSse((await chat(id, { message: 'hi' })).text);

    expect(events.some((item) => item.event === 'tool_end')).toBe(false);
  });

  it('remembers earlier turns when memory is on', async () => {
    const model = script({ text: 'one' }, { text: 'two' });
    const id = await createAgent({ memoryEnabled: true });

    const first = await chat(id, { message: 'first' });
    await chat(id, { message: 'second', conversationId: first.headers['x-conversation-id'] });

    expect(model.seen[1]?.map((message) => message.text)).toEqual([
      'You are Helper',
      'first',
      'one',
      'second',
    ]);
  });

  it('forgets earlier turns when memory is off, but still shows them in history', async () => {
    const model = script({ text: 'one' }, { text: 'two' });
    const id = await createAgent({ memoryEnabled: false });

    const first = await chat(id, { message: 'first' });
    const conversationId = first.headers['x-conversation-id'];
    await chat(id, { message: 'second', conversationId });

    expect(model.seen[1]?.map((message) => message.text)).toEqual(['You are Helper', 'second']);
    expect(await Message.countDocuments({ conversationId })).toBe(4);
  });

  it('marks the run failed when the provider fails', async () => {
    script({ error: Object.assign(new Error('nope'), { status: 429 }) });
    const id = await createAgent();

    const events = parseSse((await chat(id, { message: 'hi' })).text);

    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'LLM_RATE_LIMITED' } });
    const run = await Run.findOne({ agentId: id });
    expect(run?.status).toBe('failed');
    expect(run?.error).toBeTruthy();
  });

  it('keeps another user’s agent and conversations out of reach', async () => {
    script({ text: 'x' }, { text: 'y' });
    const id = await createAgent();

    const res = await request(app)
      .post(`/api/agents/${id}/chat`)
      .set(authHeader('mallory'))
      .send({ message: 'hi' });
    expect(res.status).toBe(404);

    const first = await chat(id, { message: 'hi' });
    const otherAgent = await createAgent();
    const wrongAgent = await chat(otherAgent, {
      message: 'hi',
      conversationId: first.headers['x-conversation-id'],
    });
    expect(wrongAgent.status).toBe(404);
  });

  it('leaves no empty chat behind when the agent cannot start', async () => {
    const id = await createAgent();
    vi.mocked(createChatModel).mockRejectedValueOnce(
      new AppError(503, 'LLM_NOT_CONFIGURED', 'No API key is set'),
    );

    const res = await chat(id, { message: 'hi' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LLM_NOT_CONFIGURED');
    expect(await Conversation.countDocuments({ agentId: id })).toBe(0);
  });

  it('continues after finished tools on a retry, instead of running them again', async () => {
    const model = script(
      { toolCalls: [{ id: 'c1', name: 'calculator', args: { expression: '6 * 7' } }] },
      { error: Object.assign(new Error('busy'), { status: 429 }) },
      { text: 'It is 42' },
    );
    const id = await createAgent({ tools: ['calculator'] });

    const failed = await chat(id, { message: '6 times 7?' });
    const conversationId = failed.headers['x-conversation-id'];
    expect(parseSse(failed.text).at(-1)?.event).toBe('error');

    const retried = await chat(id, { message: '6 times 7?', conversationId, retry: true });

    const events = parseSse(retried.text);
    expect(tokensOf(events)).toBe('It is 42');
    expect(events.at(-1)?.event).toBe('done');
    // The earlier result is shown again, not produced again.
    expect(events.find((item) => item.event === 'tool_end')?.data).toMatchObject({
      id: 'c1',
      output: '42',
    });
    expect(model.seen).toHaveLength(3);
    expect(model.seen[2]?.filter((message) => ToolMessage.isInstance(message))).toHaveLength(1);
    expect(model.seen[2]?.filter((message) => message.text === '6 times 7?')).toHaveLength(1);

    const saved = await Message.find({ conversationId }).sort({ createdAt: 1, _id: 1 });
    expect(saved.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(saved[1]?.toolCalls[0]).toMatchObject({ id: 'c1', name: 'calculator', output: '42' });
  });

  it('runs the message again on a retry when memory is off', async () => {
    const model = script(
      { text: 'Half', errorAfterText: Object.assign(new Error('busy'), { status: 429 }) },
      { text: 'Whole' },
    );
    const id = await createAgent({ memoryEnabled: false });

    const failed = await chat(id, { message: 'hi' });
    const conversationId = failed.headers['x-conversation-id'];
    await chat(id, { message: 'hi', conversationId, retry: true });

    expect(model.seen[1]?.map((message) => message.text)).toEqual(['You are Helper', 'hi']);
    const saved = await Message.find({ conversationId }).sort({ createdAt: 1, _id: 1 });
    expect(saved.map((message) => message.content)).toEqual(['hi', 'Whole']);
  });
});
