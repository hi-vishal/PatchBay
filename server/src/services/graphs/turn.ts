import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { Response } from 'express';
import type { ConversationDoc } from '../../models/Conversation.js';
import { Conversation } from '../../models/Conversation.js';
import { Message } from '../../models/Message.js';
import { AppError, errorMessage } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { openSse } from '../../utils/sse.js';
import type { GraphStreamResult, StreamableGraph, ToolCallRecord } from './stream.js';
import { emptyStreamResult, streamGraph } from './stream.js';

export const CONVERSATION_HEADER = 'X-Conversation-Id';
const RECURSION_LIMIT = 25;

/** Converts a failure into something safe to show. Provider auth errors can echo key fragments. */
export function toClientError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };

  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) {
    return { code: 'LLM_AUTH_FAILED', message: 'The AI provider rejected the configured API key.' };
  }
  if (status === 429) {
    return {
      code: 'LLM_RATE_LIMITED',
      message: 'The AI provider is rate limiting. Try again soon, or switch to another model.',
    };
  }
  if (status === 402) {
    return {
      code: 'LLM_NO_CREDIT',
      message: 'The AI provider says this account has no credit. Pick a free model or add credit.',
    };
  }
  if (status === 400 || status === 404) {
    return { code: 'LLM_BAD_REQUEST', message: errorMessage(error).slice(0, 500) };
  }
  if ((error as { name?: string } | null)?.name === 'GraphRecursionError') {
    return { code: 'RUN_TOO_LONG', message: 'The agent took too many steps and was stopped.' };
  }
  // These SDK errors keep the name "Error", so only the class name identifies them.
  if ((error as object | null)?.constructor.name === 'APIConnectionError') {
    return {
      code: 'LLM_UNREACHABLE',
      message: 'Could not reach the AI provider. If you use Ollama, check that it is running.',
    };
  }
  return { code: 'RUN_FAILED', message: 'The AI request failed. Try again.' };
}

export type TurnOutcome =
  | { status: 'completed' }
  | { status: 'aborted' }
  | { status: 'failed'; error: { code: string; message: string } };

/** A compiled graph, plus the state lookup a retry needs. Only called on a graph with memory. */
export type TurnGraph = StreamableGraph & {
  getState(config: Record<string, unknown>): Promise<{
    next: readonly string[];
    values: { messages?: BaseMessage[] };
  }>;
};

export interface ConversationTurn {
  res: Response;
  conversation: ConversationDoc;
  message: string;
  graph: TurnGraph;
  /** False when the graph has no checkpointer, so there is no thread to attach to. */
  memory: boolean;
  /** Answers the last saved message again, in place of the reply that did not finish. */
  retry?: boolean;
  /** Problems found while building the graph, reported to the client as failed tool calls. */
  preflightToolErrors?: ToolCallRecord[];
  /** Runs after the turn finishes, whatever the outcome. */
  onSettled?: (result: GraphStreamResult, outcome: TurnOutcome) => Promise<void>;
}

interface PreparedTurn {
  input: unknown;
  /** Tools from the abandoned attempt whose results the resumed run will build on. */
  carriedToolCalls: ToolCallRecord[];
}

/**
 * Saves the message and works out the graph input. A retry reuses the saved message and drops the
 * reply that did not finish. With memory, a run that stopped partway continues from its last
 * checkpoint, so the model never sees the question twice and finished tools do not run again.
 */
async function prepareTurn(turn: ConversationTurn): Promise<PreparedTurn> {
  const { conversation, message, graph, memory, retry } = turn;
  const conversationId = conversation._id;
  const asNewMessage = {
    input: { messages: [new HumanMessage(message)] },
    carriedToolCalls: [],
  };

  const previous = retry
    ? await Message.findOne({ conversationId, role: 'user' }).sort({ createdAt: -1, _id: -1 })
    : null;

  // The earlier attempt can fail before the server saves anything, which leaves nothing to reuse.
  if (previous?.content !== message) {
    await Message.create({ conversationId, role: 'user', content: message });
    return asNewMessage;
  }

  const abandoned = {
    conversationId,
    role: 'assistant' as const,
    createdAt: { $gte: previous.createdAt },
  };
  const earlierReplies = await Message.find(abandoned);
  await Message.deleteMany(abandoned);
  if (!memory) return asNewMessage;

  const state = await graph.getState({ configurable: { thread_id: conversation.threadId } });
  // Nothing is waiting to run, so this thread has no unfinished work to continue.
  if (state.next.length === 0) return asNewMessage;

  const answered = new Set(
    (state.values.messages ?? []).flatMap((item) =>
      ToolMessage.isInstance(item) ? [item.tool_call_id] : [],
    ),
  );
  return {
    input: null,
    carriedToolCalls: earlierReplies
      .flatMap((reply) => reply.toolCalls as ToolCallRecord[])
      .filter((call) => call.id && answered.has(call.id)),
  };
}

/** Runs one chat turn: saves both messages, streams events, and reports errors over SSE. */
export async function runConversationTurn(turn: ConversationTurn): Promise<void> {
  const { res, conversation, graph, memory } = turn;

  let prepared: PreparedTurn;
  try {
    prepared = await prepareTurn(turn);
  } catch (error) {
    // Nothing has been sent yet, so the usual JSON error can still report this.
    await turn
      .onSettled?.(emptyStreamResult(), { status: 'failed', error: toClientError(error) })
      .catch(() => undefined);
    throw error;
  }

  res.set(CONVERSATION_HEADER, conversation._id.toString());
  const sse = openSse(res);
  const result = emptyStreamResult();
  let outcome: TurnOutcome = { status: 'completed' };

  for (const call of [...prepared.carriedToolCalls, ...(turn.preflightToolErrors ?? [])]) {
    result.toolCalls.push(call);
    sse.send('tool_start', { id: call.id, name: call.name, input: call.args ?? {} });
    sse.send('tool_end', {
      id: call.id,
      name: call.name,
      output: call.output ?? '',
      isError: call.isError,
    });
  }

  try {
    await streamGraph(
      graph,
      prepared.input,
      {
        ...(memory ? { configurable: { thread_id: conversation.threadId } } : {}),
        recursionLimit: RECURSION_LIMIT,
        signal: sse.signal,
      },
      ({ event, data }) => sse.send(event, data),
      result,
    );

    const saved = await saveAssistantMessage(conversation, result);
    if (!result.text && result.stopReason === 'refusal') {
      outcome = {
        status: 'failed',
        error: { code: 'MODEL_REFUSED', message: 'The model declined this request.' },
      };
      sse.send('error', outcome.error);
    } else {
      sse.send('done', {
        conversationId: conversation._id.toString(),
        messageId: saved?._id.toString(),
        usage: result.usage,
      });
    }
  } catch (error) {
    // Either way, keep what was generated so the history matches what the user saw.
    await saveAssistantMessage(conversation, result).catch(() => undefined);
    if (sse.signal.aborted) {
      outcome = { status: 'aborted' };
    } else {
      logger.error(
        { conversationId: conversation._id.toString(), error: errorMessage(error) },
        'Conversation turn failed',
      );
      outcome = { status: 'failed', error: toClientError(error) };
      sse.send('error', outcome.error);
    }
  } finally {
    await turn.onSettled?.(result, outcome).catch((error: unknown) => {
      logger.error({ error: errorMessage(error) }, 'Turn cleanup failed');
    });
    sse.close();
  }
}

async function saveAssistantMessage(conversation: ConversationDoc, result: GraphStreamResult) {
  // An empty update still bumps updatedAt, which orders the conversation list.
  await Conversation.updateOne({ _id: conversation._id }, {});
  if (!result.text && result.toolCalls.length === 0) return undefined;
  return Message.create({
    conversationId: conversation._id,
    role: 'assistant',
    content: result.text,
    toolCalls: result.toolCalls,
    usage: result.usage,
  });
}
