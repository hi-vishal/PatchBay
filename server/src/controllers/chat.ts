import type { Request, Response } from 'express';
import { z } from 'zod';
import { refundReservation } from '../middleware/planGuard.js';
import { currentUser } from '../middleware/protect.js';
import { Agent, Conversation, Run } from '../models/index.js';
import type { ConversationDoc } from '../models/Conversation.js';
import type { RunDoc } from '../models/Run.js';
import type { UserDoc } from '../models/index.js';
import { buildAgentGraph, failuresAsToolCalls } from '../services/graphs/agentGraph.js';
import { buildConversationGraph } from '../services/graphs/chatGraph.js';
import { getCheckpointer } from '../services/graphs/checkpointer.js';
import type { GraphStreamResult } from '../services/graphs/stream.js';
import type { TurnGraph, TurnOutcome } from '../services/graphs/turn.js';
import { runConversationTurn } from '../services/graphs/turn.js';
import { createChatModel, listProviders, resolveDefaultModel } from '../services/llm/llm.js';
import { modelConfigSchema } from '../services/llm/modelConfig.js';
import { orNotFound } from '../utils/ownership.js';
import type { IdParams } from '../utils/validation.js';
import { objectId } from '../utils/validation.js';

const MAX_TITLE_CHARS = 60;

const turnFields = {
  message: z.string().trim().min(1).max(32_000),
  conversationId: objectId.optional(),
  /** Answers the last message again, in place of a reply that did not finish. */
  retry: z.boolean().optional(),
};

export const chatSchema = z.object({ ...turnFields, model: modelConfigSchema.optional() });
type ChatBody = z.infer<typeof chatSchema>;

/** Finds the conversation for this turn, or starts one titled after the first message. */
export async function resolveConversation(
  user: UserDoc,
  body: { conversationId?: string; message: string },
  agentId?: string,
) {
  if (body.conversationId) {
    return orNotFound(
      await Conversation.findOne({
        _id: body.conversationId,
        ownerId: user._id,
        ...(agentId ? { agentId } : { agentId: { $exists: false } }),
      }),
      'Conversation',
    );
  }
  return Conversation.create({
    ownerId: user._id,
    ...(agentId ? { agentId } : {}),
    title: body.message.slice(0, MAX_TITLE_CHARS),
  });
}

export async function chat(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const body = req.body as ChatBody;

  // Everything that can fail with a plain JSON error happens before the stream opens.
  const model = await createChatModel(
    body.model ?? (await resolveDefaultModel(user._id)),
    user._id,
  );
  const conversation = await resolveConversation(user, body);
  const graph = buildConversationGraph({ model, checkpointer: getCheckpointer() });

  await runConversationTurn({
    res,
    conversation,
    message: body.message,
    graph: graph as unknown as TurnGraph,
    memory: true,
    retry: body.retry,
    onSettled: async (_result, outcome) => {
      if (outcome.status === 'failed') await refundReservation(req);
    },
  });
}

export const agentChatSchema = z.object(turnFields);

/** Records an agent turn as a run, so its tool calls appear in the run history. */
async function finishAgentRun(
  runId: unknown,
  result: GraphStreamResult,
  outcome: TurnOutcome,
): Promise<void> {
  const endedAt = new Date();
  await Run.updateOne(
    { _id: runId },
    {
      $set: {
        status: outcome.status === 'completed' ? 'succeeded' : 'failed',
        output: result.text,
        endedAt,
        ...(outcome.status === 'failed' ? { error: outcome.error.message } : {}),
        ...(outcome.status === 'aborted' ? { error: 'The client disconnected.' } : {}),
        steps: result.toolCalls.map((call) => ({
          nodeId: call.id ?? call.name,
          nodeType: 'tool',
          label: call.name,
          status: call.isError ? 'failed' : 'succeeded',
          input: call.args,
          output: call.output,
          endedAt,
        })),
      },
    },
  );
}

export async function agentChat(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { id } = req.params as IdParams;
  const body = req.body as z.infer<typeof agentChatSchema>;

  const agent = orNotFound(await Agent.findOne({ _id: id, ownerId: user._id }), 'Agent');
  // The graph comes first: a missing API key should not leave an empty chat behind.
  const built = await buildAgentGraph(agent);

  let conversation: ConversationDoc;
  let run: RunDoc;
  try {
    conversation = await resolveConversation(user, body, id);
    run = await Run.create({
      ownerId: user._id,
      agentId: agent._id,
      threadId: conversation.threadId,
      status: 'running',
      input: body.message,
      startedAt: new Date(),
    });
  } catch (error) {
    await built.close();
    throw error;
  }

  await runConversationTurn({
    res,
    conversation,
    message: body.message,
    graph: built.graph,
    memory: built.usesMemory,
    retry: body.retry,
    preflightToolErrors: failuresAsToolCalls(built.failures),
    onSettled: async (result, outcome) => {
      await Promise.allSettled([
        built.close(),
        finishAgentRun(run._id, result, outcome),
        outcome.status === 'failed' ? refundReservation(req) : undefined,
      ]);
    },
  });
}

export async function getProviders(req: Request, res: Response): Promise<void> {
  const ownerId = currentUser(req)._id;
  const [items, defaultModel] = await Promise.all([
    listProviders(ownerId),
    resolveDefaultModel(ownerId),
  ]);
  res.json({ items, default: defaultModel });
}
