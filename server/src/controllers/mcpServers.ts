import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { currentUser } from '../middleware/protect.js';
import type { McpServerDoc } from '../models/index.js';
import { Agent, MCP_TRANSPORTS, McpServer } from '../models/index.js';
import { inspectMcpServer } from '../services/mcp/manager.js';
import { AppError, badRequest } from '../utils/errors.js';
import { encryptJson } from '../utils/crypto.js';
import { orNotFound } from '../utils/ownership.js';
import type { IdParams, ListQuery } from '../utils/validation.js';

const stringRecord = z.record(z.string().min(1).max(200), z.string().max(4000));

const authSchema = z.object({
  bearerToken: z.string().min(1).max(4000).optional(),
  headers: stringRecord.optional(),
  env: stringRecord.optional(),
});

const mcpFields = {
  name: z.string().trim().min(1).max(100),
  transport: z.enum(MCP_TRANSPORTS),
  url: z.url({ protocol: /^https?$/, error: 'Must be an http or https URL' }).optional(),
  command: z.string().trim().min(1).max(500).optional(),
  args: z.array(z.string().max(1000)).max(50).optional(),
  enabled: z.boolean().optional(),
  // Write-only. Send null to remove stored credentials.
  auth: authSchema.nullable().optional(),
};

export const createMcpServerSchema = z.object(mcpFields);
export const updateMcpServerSchema = z.object(mcpFields).partial();

type UpdateMcpServerBody = z.infer<typeof updateMcpServerSchema>;

/** A stdio server runs a command on the API host, which only a trusted deployment may allow. */
function assertTransportConfig(server: McpServerDoc): void {
  if (server.transport === 'stdio') {
    if (!env.MCP_ALLOW_STDIO) {
      throw new AppError(
        403,
        'MCP_STDIO_DISABLED',
        'stdio MCP servers are disabled on this deployment. Use streamable_http or sse.',
      );
    }
    if (!server.command) throw badRequest('A stdio server needs a command');
    return;
  }
  if (!server.url) throw badRequest(`A ${server.transport} server needs a url`);
}

function applyChanges(server: McpServerDoc, body: UpdateMcpServerBody): void {
  const { auth, ...fields } = body;
  server.set(fields);
  if (auth === null) server.set('encryptedAuth', undefined);
  else if (auth) server.set('encryptedAuth', encryptJson(auth));
  assertTransportConfig(server);
}

export async function listMcpServers(req: Request, res: Response): Promise<void> {
  const { limit, skip } = req.query as unknown as ListQuery;
  const items = await McpServer.find({ ownerId: currentUser(req)._id })
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit);
  res.json({ items });
}

export async function createMcpServer(req: Request, res: Response): Promise<void> {
  const server = new McpServer({ ownerId: currentUser(req)._id });
  applyChanges(server, req.body as UpdateMcpServerBody);
  await server.save();
  res.status(201).json({ server });
}

export async function getMcpServer(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const server = orNotFound(
    await McpServer.findOne({ _id: id, ownerId: currentUser(req)._id }),
    'MCP server',
  );
  res.json({ server });
}

export async function updateMcpServer(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const server = orNotFound(
    await McpServer.findOne({ _id: id, ownerId: currentUser(req)._id }),
    'MCP server',
  );
  applyChanges(server, req.body as UpdateMcpServerBody);
  await server.save();
  res.json({ server });
}

export async function deleteMcpServer(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { id } = req.params as IdParams;
  orNotFound(await McpServer.findOneAndDelete({ _id: id, ownerId: user._id }), 'MCP server');
  await Agent.updateMany({ ownerId: user._id }, { $pull: { mcpServerIds: id } });
  res.status(204).end();
}

export async function testMcpServer(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const server = orNotFound(
    await McpServer.findOne({ _id: id, ownerId: currentUser(req)._id }),
    'MCP server',
  );
  const result = await inspectMcpServer(server);
  if (result.ok) {
    server.lastToolSync = new Date();
    await server.save();
  }
  res.json(result);
}

export async function listMcpServerTools(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const server = orNotFound(
    await McpServer.findOne({ _id: id, ownerId: currentUser(req)._id }),
    'MCP server',
  );
  const result = await inspectMcpServer(server);
  if (!result.ok) throw new AppError(502, 'MCP_CONNECT_FAILED', result.error);
  res.json({ items: result.tools });
}
