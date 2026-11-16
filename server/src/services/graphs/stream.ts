import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages';
import { AIMessage, ToolMessage } from '@langchain/core/messages';

export interface ToolCallRecord {
  id?: string;
  name: string;
  args?: unknown;
  output?: string;
  isError: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type AgentEvent =
  | { event: 'token'; data: { text: string } }
  | { event: 'tool_start'; data: { id?: string; name: string; input: unknown } }
  | { event: 'tool_end'; data: { id?: string; name: string; output: string; isError: boolean } }
  | { event: 'interrupt'; data: { value: unknown } };

export type EmitEvent = (event: AgentEvent) => void;

export interface GraphStreamResult {
  text: string;
  toolCalls: ToolCallRecord[];
  usage: TokenUsage;
  interrupts: unknown[];
  /** The last provider stop reason, for example "refusal". */
  stopReason?: string;
}

/** The part of a compiled graph this module uses. Compiled graph generics do not need to leak. */
export interface StreamableGraph {
  stream(input: unknown, options: Record<string, unknown>): Promise<AsyncIterable<unknown>>;
}

interface ToolStreamEvent {
  event: 'on_tool_start' | 'on_tool_event' | 'on_tool_end' | 'on_tool_error';
  toolCallId?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
}

const MAX_EVENT_OUTPUT_CHARS = 20_000;

function clip(text: string): string {
  return text.length > MAX_EVENT_OUTPUT_CHARS
    ? `${text.slice(0, MAX_EVENT_OUTPUT_CHARS)}\n[truncated]`
    : text;
}

/** Reduces whatever a tool returned to display text, and spots results marked as errors. */
function describeToolOutput(output: unknown): { text: string; isError: boolean } {
  if (ToolMessage.isInstance(output)) {
    const message = output as BaseMessage & { status?: string };
    return { text: clip(message.text), isError: message.status === 'error' };
  }
  if (typeof output === 'string') return { text: clip(output), isError: false };
  return { text: clip(JSON.stringify(output) ?? ''), isError: false };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Providers report this in different places: Anthropic streams use additional_kwargs. */
function stopReasonOf(message: AIMessage | AIMessageChunk): string | undefined {
  const metadata = message.response_metadata as { stop_reason?: unknown; finish_reason?: unknown };
  const kwargs = message.additional_kwargs as { stop_reason?: unknown };
  const reason = metadata?.stop_reason ?? metadata?.finish_reason ?? kwargs?.stop_reason;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * Runs a graph and converts its stream into the app's events. Returns the accumulated result,
 * including the part produced so far if the caller aborts through `signal`.
 */
export async function streamGraph(
  graph: StreamableGraph,
  input: unknown,
  config: Record<string, unknown>,
  emit: EmitEvent,
  result: GraphStreamResult = emptyStreamResult(),
): Promise<GraphStreamResult> {
  const stream = await graph.stream(input, {
    ...config,
    streamMode: ['messages', 'updates', 'tools'],
  });

  const pending = new Map<string, ToolCallRecord>();
  let lastMessageId: string | undefined;

  for await (const part of stream) {
    const [mode, payload] = part as [string, unknown];

    if (mode === 'messages') {
      const [message] = payload as [BaseMessage];
      if (!AIMessage.isInstance(message) && message.getType() !== 'ai') continue;
      const ai = message as AIMessageChunk;

      const text = ai.text;
      if (text) {
        // Text from separate model calls would otherwise run together.
        if (result.text && ai.id !== lastMessageId) {
          result.text += '\n\n';
          emit({ event: 'token', data: { text: '\n\n' } });
        }
        lastMessageId = ai.id;
        result.text += text;
        emit({ event: 'token', data: { text } });
      }

      const usage = ai.usage_metadata;
      if (usage) {
        result.usage.inputTokens += usage.input_tokens ?? 0;
        result.usage.outputTokens += usage.output_tokens ?? 0;
        result.usage.totalTokens += usage.total_tokens ?? 0;
      }
      result.stopReason = stopReasonOf(ai) ?? result.stopReason;
      continue;
    }

    if (mode === 'tools') {
      const tool = payload as ToolStreamEvent;
      const key = tool.toolCallId ?? tool.name;

      if (tool.event === 'on_tool_start') {
        const record: ToolCallRecord = {
          id: tool.toolCallId,
          name: tool.name,
          args: tool.input,
          isError: false,
        };
        pending.set(key, record);
        result.toolCalls.push(record);
        emit({
          event: 'tool_start',
          data: { id: tool.toolCallId, name: tool.name, input: tool.input },
        });
      } else if (tool.event === 'on_tool_end' || tool.event === 'on_tool_error') {
        const failed = tool.event === 'on_tool_error';
        const { text, isError } = failed
          ? { text: describeError(tool.error), isError: true }
          : describeToolOutput(tool.output);
        const record = pending.get(key);
        if (record) {
          record.output = text;
          record.isError = isError;
          pending.delete(key);
        }
        emit({
          event: 'tool_end',
          data: { id: tool.toolCallId, name: tool.name, output: text, isError },
        });
      }
      continue;
    }

    if (mode === 'updates') {
      const interrupts = (payload as { __interrupt__?: { value: unknown }[] }).__interrupt__;
      for (const interrupt of interrupts ?? []) {
        result.interrupts.push(interrupt.value);
        emit({ event: 'interrupt', data: { value: interrupt.value } });
      }
    }
  }

  return result;
}

export function emptyStreamResult(): GraphStreamResult {
  return {
    text: '',
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    interrupts: [],
  };
}
