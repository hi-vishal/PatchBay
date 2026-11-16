import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { BaseCheckpointSaver, LangGraphRunnableConfig } from '@langchain/langgraph';
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';

type GraphState = typeof MessagesAnnotation.State;

export const LLM_NODE = 'llm';
export const TOOLS_NODE = 'tools';

/** Sends the graph to the tool node when the latest model message asks for tools. */
export function routeAfterLlm(state: GraphState): typeof TOOLS_NODE | typeof END {
  const last = state.messages.at(-1);
  return last && AIMessage.isInstance(last) && (last.tool_calls?.length ?? 0) > 0
    ? TOOLS_NODE
    : END;
}

/**
 * A run stopped between a tool request and its result (client disconnect, crash) leaves a tool
 * call with no answer, which providers reject on the next request. This answers those calls.
 * It only adds messages, so the history sent to the provider stays append-only.
 */
export function repairDanglingToolCalls(messages: BaseMessage[]): BaseMessage[] {
  const answered = new Set(
    messages.flatMap((message) => (ToolMessage.isInstance(message) ? [message.tool_call_id] : [])),
  );
  return messages.flatMap((message) => {
    if (!AIMessage.isInstance(message)) return [message];
    const missing = (message.tool_calls ?? []).filter((call) => call.id && !answered.has(call.id));
    return [
      message,
      ...missing.map(
        (call) =>
          new ToolMessage({
            tool_call_id: call.id as string,
            name: call.name,
            status: 'error',
            content: 'This tool call was interrupted before it finished.',
          }),
      ),
    ];
  });
}

export interface ConversationGraphOptions {
  model: BaseChatModel;
  tools?: StructuredToolInterface[];
  systemPrompt?: string;
  /** false runs without memory: each turn sees only its own messages. */
  checkpointer: BaseCheckpointSaver | false;
}

/** The llm -> tools -> llm loop that chat and agents share. */
export function buildConversationGraph({
  model,
  tools = [],
  systemPrompt,
  checkpointer,
}: ConversationGraphOptions) {
  if (tools.length > 0 && !model.bindTools) {
    throw new Error('This model does not support tools');
  }
  const runnable = tools.length > 0 && model.bindTools ? model.bindTools(tools) : model;

  const callModel = async (state: GraphState, config: LangGraphRunnableConfig) => {
    const history = repairDanglingToolCalls(state.messages);
    const messages = systemPrompt ? [new SystemMessage(systemPrompt), ...history] : history;
    const response = await runnable.invoke(messages, config);
    return { messages: [response] };
  };

  return new StateGraph(MessagesAnnotation)
    .addNode(LLM_NODE, callModel)
    .addNode(TOOLS_NODE, new ToolNode(tools))
    .addEdge(START, LLM_NODE)
    .addConditionalEdges(LLM_NODE, routeAfterLlm, [TOOLS_NODE, END])
    .addEdge(TOOLS_NODE, LLM_NODE)
    .compile({ checkpointer });
}
