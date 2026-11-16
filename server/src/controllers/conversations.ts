import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../middleware/protect.js';
import { Agent, Conversation, Message } from '../models/index.js';
import { deleteThreadCheckpoints } from '../services/graphs/checkpointer.js';
import { badRequest } from '../utils/errors.js';
import { orNotFound } from '../utils/ownership.js';
import type { IdParams, ListQuery } from '../utils/validation.js';
import { objectId } from '../utils/validation.js';

export const createConversationSchema = z.object({
  agentId: objectId.optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

export const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const listConversationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  agentId: objectId.optional(),
});
type ListConversationsQuery = z.infer<typeof listConversationsQuery>;

export async function listConversations(req: Request, res: Response): Promise<void> {
  const { limit, skip, agentId } = req.query as unknown as ListConversationsQuery;
  const items = await Conversation.find({
    ownerId: currentUser(req)._id,
    ...(agentId ? { agentId } : {}),
  })
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit);
  res.json({ items });
}

export async function createConversation(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const body = req.body as z.infer<typeof createConversationSchema>;
  if (body.agentId) {
    const owned = await Agent.exists({ _id: body.agentId, ownerId: user._id });
    if (!owned) throw badRequest('Agent not found');
  }
  const conversation = await Conversation.create({ ...body, ownerId: user._id });
  res.status(201).json({ conversation });
}

export async function getConversation(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const conversation = orNotFound(
    await Conversation.findOne({ _id: id, ownerId: currentUser(req)._id }),
    'Conversation',
  );
  res.json({ conversation });
}

export async function updateConversation(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const conversation = orNotFound(
    await Conversation.findOneAndUpdate(
      { _id: id, ownerId: currentUser(req)._id },
      { $set: req.body as z.infer<typeof updateConversationSchema> },
      { returnDocument: 'after', runValidators: true },
    ),
    'Conversation',
  );
  res.json({ conversation });
}

export async function deleteConversation(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const conversation = orNotFound(
    await Conversation.findOneAndDelete({ _id: id, ownerId: currentUser(req)._id }),
    'Conversation',
  );
  await Message.deleteMany({ conversationId: conversation._id });
  await deleteThreadCheckpoints(conversation.threadId);
  res.status(204).end();
}

export async function listMessages(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const { limit, skip } = req.query as unknown as ListQuery;
  const conversation = orNotFound(
    await Conversation.findOne({ _id: id, ownerId: currentUser(req)._id }),
    'Conversation',
  );
  // The newest page, returned oldest first, so a long chat opens on its latest messages.
  const newestFirst = await Message.find({ conversationId: conversation._id })
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit);
  const items = newestFirst.reverse();
  res.json({ items });
}
