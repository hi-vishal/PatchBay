import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { END, MemorySaver, interrupt } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  TOOLS_NODE,
  buildConversationGraph,
  repairDanglingToolCalls,
  routeAfterLlm,
} from '../src/services/graphs/chatGraph.js';
import type { AgentEvent, StreamableGraph } from '../src/services/graphs/stream.js';
import { streamGraph } from '../src/services/graphs/stream.js';
import { getBuiltinTools } from '../src/services/tools/index.js';
import { ScriptedChatModel } from './helpers/scriptedModel.js';

async function run(
  graph: unknown,
  message: string,
  threadId = 'thread',
): Promise<{ events: AgentEvent[]; result: Awaited<ReturnType<typeof streamGraph>> }> {
  const events: AgentEvent[] = [];
  const result = await streamGraph(
    graph as StreamableGraph,
    { messages: [new HumanMessage(message)] },
    { configurable: { thread_id: threadId } },
    (event) => events.push(event),
  );
  return { events, result };
}

describe('routeAfterLlm', () => {
  it('routes to tools when the model requested a tool', () => {
    const message = new AIMessage({
      content: '',
      tool_calls: [{ id: '1', name: 'calculator', args: {}, type: 'tool_call' }],
    });
    expect(routeAfterLlm({ messages: [message] })).toBe(TOOLS_NODE);
  });

  it('ends when the model answered in text', () => {
    expect(routeAfterLlm({ messages: [new AIMessage('done')] })).toBe(END);
  });

  it('ends when the last message is not from the model', () => {
    expect(routeAfterLlm({ messages: [new HumanMessage('hi')] })).toBe(END);
    expect(routeAfterLlm({ messages: [] })).toBe(END);
  });
});

describe('repairDanglingToolCalls', () => {
  const askForTool = new AIMessage({
    content: '',
    tool_calls: [{ id: 'call-1', name: 'calculator', args: {}, type: 'tool_call' }],
  });

  it('answers a tool call that has no result', () => {
    const repaired = repairDanglingToolCalls([new HumanMessage('hi'), askForTool]);
    expect(repaired).toHaveLength(3);
    expect(ToolMessage.isInstance(repaired[2])).toBe(true);
    expect((repaired[2] as ToolMessage).tool_call_id).toBe('call-1');
  });

  it('leaves answered tool calls alone', () => {
    const answer = new ToolMessage({ tool_call_id: 'call-1', content: '2' });
    const messages = [new HumanMessage('hi'), askForTool, answer];
    expect(repairDanglingToolCalls(messages)).toEqual(messages);
  });
});

describe('conversation graph', () => {
  it('streams text and usage without tools', async () => {
    const model = new ScriptedChatModel([{ text: 'Hello there friend' }]);
    const graph = buildConversationGraph({ model, checkpointer: new MemorySaver() });

    const { events, result } = await run(graph, 'hi');

    expect(events.filter((item) => item.event === 'token').length).toBeGreaterThan(1);
    expect(result.text).toBe('Hello there friend');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('runs llm -> tools -> llm and reports tool events', async () => {
    const model = new ScriptedChatModel([
      {
        text: 'Let me work that out.',
        toolCalls: [{ id: 'c1', name: 'calculator', args: { expression: '6 * 7' } }],
      },
      { text: 'The answer is 42.' },
    ]);
    const graph = buildConversationGraph({
      model,
      tools: getBuiltinTools(['calculator']),
      checkpointer: new MemorySaver(),
    });

    const { events, result } = await run(graph, 'what is 6 times 7?');

    expect(events.find((item) => item.event === 'tool_start')?.data).toMatchObject({
      id: 'c1',
      name: 'calculator',
    });
    expect(events.find((item) => item.event === 'tool_end')?.data).toMatchObject({
      id: 'c1',
      name: 'calculator',
      output: '42',
      isError: false,
    });
    expect(result.text).toBe('Let me work that out.\n\nThe answer is 42.');
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ id: 'c1', name: 'calculator', output: '42', isError: false }),
    ]);
    // The tool result went back to the model on the second call.
    expect(model.seen[1]?.some((message) => ToolMessage.isInstance(message))).toBe(true);
  });

  it('turns a tool failure into a tool error, and the run continues', async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ id: 'c1', name: 'calculator', args: { expression: '1 / 0' } }] },
      { text: 'That cannot be computed.' },
    ]);
    const graph = buildConversationGraph({
      model,
      tools: getBuiltinTools(['calculator']),
      checkpointer: new MemorySaver(),
    });

    const { events, result } = await run(graph, 'divide by zero');

    const end = events.find((item) => item.event === 'tool_end');
    expect(end?.data).toMatchObject({ name: 'calculator', isError: true });
    expect(result.text).toBe('That cannot be computed.');
    expect(result.toolCalls[0]?.isError).toBe(true);
  });

  it('injects the system prompt on every call without storing it', async () => {
    const model = new ScriptedChatModel([{ text: 'one' }, { text: 'two' }]);
    const checkpointer = new MemorySaver();
    const graph = buildConversationGraph({ model, systemPrompt: 'Be brief', checkpointer });

    await run(graph, 'first');
    await run(graph, 'second');

    for (const seen of model.seen) {
      expect(SystemMessage.isInstance(seen[0])).toBe(true);
      expect(seen[0]?.text).toBe('Be brief');
    }
    const state = await graph.getState({ configurable: { thread_id: 'thread' } });
    expect(state.values.messages.some((m: unknown) => SystemMessage.isInstance(m))).toBe(false);
  });

  it('remembers earlier turns on the same thread only', async () => {
    const model = new ScriptedChatModel([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
    const graph = buildConversationGraph({ model, checkpointer: new MemorySaver() });

    await run(graph, 'first', 'thread-1');
    await run(graph, 'second', 'thread-1');
    await run(graph, 'other', 'thread-2');

    expect(model.seen[1]?.map((message) => message.text)).toEqual(['first', 'a', 'second']);
    expect(model.seen[2]?.map((message) => message.text)).toEqual(['other']);
  });

  it('emits an interrupt event when a tool pauses the run', async () => {
    const askPerson = tool(() => interrupt({ question: 'Send it?' }) as string, {
      name: 'ask_person',
      description: 'Asks a person before continuing',
      schema: z.object({}),
    });
    const model = new ScriptedChatModel([
      { toolCalls: [{ id: 'c1', name: 'ask_person', args: {} }] },
    ]);
    const graph = buildConversationGraph({
      model,
      tools: [askPerson],
      checkpointer: new MemorySaver(),
    });

    const { events, result } = await run(graph, 'send the report');

    expect(events).toContainEqual({
      event: 'interrupt',
      data: { value: { question: 'Send it?' } },
    });
    expect(result.interrupts).toEqual([{ question: 'Send it?' }]);
    const state = await graph.getState({ configurable: { thread_id: 'thread' } });
    expect(state.next).toEqual([TOOLS_NODE]);
  });

  it('forgets between turns when memory is off', async () => {
    const model = new ScriptedChatModel([{ text: 'a' }, { text: 'b' }]);
    const graph = buildConversationGraph({ model, checkpointer: false });

    for (const message of ['first', 'second']) {
      await streamGraph(
        graph as unknown as StreamableGraph,
        { messages: [new HumanMessage(message)] },
        {},
        () => undefined,
      );
    }
    expect(model.seen[1]?.map((message) => message.text)).toEqual(['second']);
  });
});
