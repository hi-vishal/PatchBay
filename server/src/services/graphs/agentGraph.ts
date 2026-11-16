import type { AgentDoc } from '../../models/Agent.js';
import { McpServer } from '../../models/McpServer.js';
import { createChatModel } from '../llm/llm.js';
import type { McpServerFailure } from '../mcp/manager.js';
import { loadMcpToolset } from '../mcp/manager.js';
import { getBuiltinTools } from '../tools/index.js';
import { buildConversationGraph } from './chatGraph.js';
import { getCheckpointer } from './checkpointer.js';
import type { ToolCallRecord } from './stream.js';
import type { TurnGraph } from './turn.js';

export interface BuiltAgentGraph {
  graph: TurnGraph & {
    invoke(input: unknown, options?: Record<string, unknown>): Promise<unknown>;
  };
  failures: McpServerFailure[];
  usesMemory: boolean;
  /** Closes MCP clients. Call it when the run ends. */
  close: () => Promise<void>;
}

function withUnavailableServers(systemPrompt: string, failures: McpServerFailure[]): string {
  if (failures.length === 0) return systemPrompt;
  const names = failures.map((failure) => failure.serverName).join(', ');
  const note = `These connected tool servers are unavailable right now: ${names}. If a request needs them, say so instead of guessing.`;
  return systemPrompt ? `${systemPrompt}\n\n${note}` : note;
}

/** Builds a compiled graph from a saved agent. MCP servers that fail are reported, not thrown. */
export async function buildAgentGraph(
  agent: AgentDoc,
  options: { memory?: boolean } = {},
): Promise<BuiltAgentGraph> {
  // The model comes first: it can fail on a missing key, and no MCP connection is open yet.
  const model = await createChatModel(
    {
      provider: agent.model.provider,
      name: agent.model.name,
      temperature: agent.model.temperature,
    },
    agent.ownerId,
  );

  const servers = await McpServer.find({
    _id: { $in: agent.mcpServerIds },
    ownerId: agent.ownerId,
    enabled: true,
  });
  const toolset = await loadMcpToolset(servers);

  try {
    const usesMemory = options.memory ?? agent.memoryEnabled;
    const graph = buildConversationGraph({
      model,
      tools: [...getBuiltinTools(agent.tools), ...toolset.tools],
      systemPrompt: withUnavailableServers(agent.systemPrompt, toolset.failures),
      checkpointer: usesMemory ? getCheckpointer() : false,
    });
    return {
      graph: graph as unknown as BuiltAgentGraph['graph'],
      failures: toolset.failures,
      usesMemory,
      close: toolset.close,
    };
  } catch (error) {
    await toolset.close();
    throw error;
  }
}

/** Presents a server that would not connect as a failed tool call in the steps timeline. */
export function failuresAsToolCalls(failures: McpServerFailure[]): ToolCallRecord[] {
  return failures.map((failure) => ({
    id: `mcp-${failure.serverId}`,
    name: `mcp:${failure.serverName}`,
    args: {},
    output: failure.error,
    isError: true,
  }));
}
