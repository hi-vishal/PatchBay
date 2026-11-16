import type { Request, Response } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { currentUser } from '../middleware/protect.js';
import { Agent, Conversation, McpServer } from '../models/index.js';
import { modelConfigSchema } from '../services/llm/modelConfig.js';
import { BUILTIN_TOOL_NAMES } from '../services/tools/names.js';
import { badRequest } from '../utils/errors.js';
import { orNotFound } from '../utils/ownership.js';
import type { IdParams, ListQuery } from '../utils/validation.js';
import { objectId } from '../utils/validation.js';

// Field defaults live on the Mongoose schema. Zod 4 applies .default() inside .partial(),
// which would make every PATCH reset fields the client did not send.
const agentFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().max(20_000).optional(),
  tools: z.array(z.enum(BUILTIN_TOOL_NAMES)).max(BUILTIN_TOOL_NAMES.length).optional(),
  mcpServerIds: z.array(objectId).max(10).optional(),
  memoryEnabled: z.boolean().optional(),
  isPublic: z.boolean().optional(),
};

export const createAgentSchema = z.object({ ...agentFields, model: modelConfigSchema });
export const updateAgentSchema = z.object({ ...agentFields, model: modelConfigSchema }).partial();

type CreateAgentBody = z.infer<typeof createAgentSchema>;
type UpdateAgentBody = z.infer<typeof updateAgentSchema>;

async function assertOwnsMcpServers(ownerId: Types.ObjectId, ids: string[] = []): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const owned = await McpServer.countDocuments({ _id: { $in: unique }, ownerId });
  if (owned !== unique.length) throw badRequest('One or more MCP servers were not found');
}

export async function listAgents(req: Request, res: Response): Promise<void> {
  const { limit, skip } = req.query as unknown as ListQuery;
  const items = await Agent.find({ ownerId: currentUser(req)._id })
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit);
  res.json({ items });
}

export async function createAgent(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const body = req.body as CreateAgentBody;
  await assertOwnsMcpServers(user._id, body.mcpServerIds);
  const agent = await Agent.create({ ...body, ownerId: user._id });
  res.status(201).json({ agent });
}

export async function getAgent(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const agent = orNotFound(
    await Agent.findOne({ _id: id, ownerId: currentUser(req)._id }),
    'Agent',
  );
  res.json({ agent });
}

export async function updateAgent(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { id } = req.params as IdParams;
  const body = req.body as UpdateAgentBody;
  const agent = orNotFound(await Agent.findOne({ _id: id, ownerId: user._id }), 'Agent');
  await assertOwnsMcpServers(user._id, body.mcpServerIds);
  agent.set(body);
  await agent.save();
  res.json({ agent });
}

export async function deleteAgent(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { id } = req.params as IdParams;
  orNotFound(await Agent.findOneAndDelete({ _id: id, ownerId: user._id }), 'Agent');
  // Past conversations stay readable and continue as plain chats.
  await Conversation.updateMany({ agentId: id, ownerId: user._id }, { $unset: { agentId: 1 } });
  res.status(204).end();
}
