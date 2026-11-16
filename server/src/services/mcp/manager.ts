import type { StructuredToolInterface } from '@langchain/core/tools';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { env } from '../../config/env.js';
import type { McpServerDoc } from '../../models/McpServer.js';
import { decryptJson } from '../../utils/crypto.js';
import { AppError, errorMessage } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { assertPublicUrl } from '../../utils/ssrf.js';

export interface McpAuth {
  bearerToken?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface McpServerFailure {
  serverId: string;
  serverName: string;
  error: string;
}

export interface McpToolset {
  tools: StructuredToolInterface[];
  failures: McpServerFailure[];
  close: () => Promise<void>;
}

export interface McpToolInfo {
  name: string;
  description: string;
}

const DISCOVERY_TIMEOUT_MS = 15_000;
const TOOL_CALL_TIMEOUT_MS = 60_000;
const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** Becomes the tool name prefix, so it has to fit provider rules for tool names. */
function serverKey(server: McpServerDoc): string {
  const slug = server.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 16);
  return `${slug || 'mcp'}_${server._id.toString().slice(-6)}`;
}

function buildConnection(server: McpServerDoc) {
  const auth = server.encryptedAuth ? decryptJson<McpAuth>(server.encryptedAuth) : {};

  if (server.transport === 'stdio') {
    if (!env.MCP_ALLOW_STDIO) {
      throw new AppError(403, 'MCP_STDIO_DISABLED', 'stdio MCP servers are disabled');
    }
    return {
      transport: 'stdio' as const,
      command: server.command ?? '',
      args: server.args,
      ...(auth.env ? { env: auth.env } : {}),
    };
  }

  const headers: Record<string, string> = { ...auth.headers };
  if (auth.bearerToken) headers.Authorization = `Bearer ${auth.bearerToken}`;
  const url = server.url ?? '';
  return server.transport === 'sse'
    ? { transport: 'sse' as const, url, headers }
    : { transport: 'http' as const, url, headers };
}

async function assertReachable(server: McpServerDoc): Promise<void> {
  if (server.transport === 'stdio' || env.MCP_ALLOW_PRIVATE_NETWORKS) return;
  await assertPublicUrl(server.url ?? '');
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

interface Connected {
  tools: StructuredToolInterface[];
  close: () => Promise<void>;
}

/** Each server gets its own client, so one that hangs or fails cannot hold back the others. */
async function connect(server: McpServerDoc): Promise<Connected> {
  await assertReachable(server);
  const client = new MultiServerMCPClient({
    servers: { [serverKey(server)]: buildConnection(server) },
    onConnectionError: 'throw',
    prefixToolNameWithServerName: true,
    defaultToolTimeout: TOOL_CALL_TIMEOUT_MS,
  });
  const close = () => client.close();
  try {
    const tools = await withTimeout(
      client.getTools(),
      DISCOVERY_TIMEOUT_MS,
      `Timed out after ${DISCOVERY_TIMEOUT_MS / 1000}s while connecting`,
    );
    return { tools: tools.filter((tool) => VALID_TOOL_NAME.test(tool.name)), close };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

/**
 * Connects to the given servers and collects their tools. A failing server is reported in
 * `failures` and never throws, so a run continues with whatever is reachable.
 */
export async function loadMcpToolset(servers: McpServerDoc[]): Promise<McpToolset> {
  const results = await Promise.allSettled(servers.map((server) => connect(server)));

  const tools: StructuredToolInterface[] = [];
  const closers: (() => Promise<void>)[] = [];
  const failures: McpServerFailure[] = [];

  results.forEach((result, index) => {
    const server = servers[index] as McpServerDoc;
    if (result.status === 'fulfilled') {
      tools.push(...result.value.tools);
      closers.push(result.value.close);
      return;
    }
    const error = errorMessage(result.reason);
    logger.warn({ serverId: server._id.toString(), error }, 'MCP server failed to connect');
    failures.push({ serverId: server._id.toString(), serverName: server.name, error });
  });

  return {
    tools,
    failures,
    close: async () => {
      await Promise.allSettled(closers.map((close) => close()));
    },
  };
}

export type McpInspection =
  { ok: true; tools: McpToolInfo[] } | { ok: false; tools: []; error: string };

/** Connects to one server to list its tools, then disconnects. */
export async function inspectMcpServer(server: McpServerDoc): Promise<McpInspection> {
  let connected: Connected;
  try {
    connected = await connect(server);
  } catch (error) {
    return { ok: false, tools: [], error: errorMessage(error) };
  }
  try {
    return {
      ok: true,
      tools: connected.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    };
  } finally {
    await connected.close().catch(() => undefined);
  }
}
