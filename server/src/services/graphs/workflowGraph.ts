import type { AIMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseCheckpointSaver, LangGraphRunnableConfig } from '@langchain/langgraph';
import {
  Annotation,
  END,
  START,
  StateGraph,
  interrupt,
  isGraphInterrupt,
} from '@langchain/langgraph';
import type { Types } from 'mongoose';
import { Agent } from '../../models/Agent.js';
import { AppError, errorMessage } from '../../utils/errors.js';
import { createChatModel, resolveDefaultModel } from '../llm/llm.js';
import { getBuiltinTool } from '../tools/index.js';
import { buildAgentGraph } from './agentGraph.js';
import type { ParsedNode, ParsedWorkflow, TemplateValues } from './workflowDefinition.js';
import { evaluateCondition, renderTemplate } from './workflowDefinition.js';

export const WorkflowState = Annotation.Root({
  input: Annotation<string>({ reducer: (_, next) => next, default: () => '' }),
  // Reducers let parallel branches write without LangGraph rejecting the concurrent update.
  last: Annotation<string>({ reducer: (_, next) => next, default: () => '' }),
  outputs: Annotation<Record<string, string>>({
    reducer: (current, next) => ({ ...current, ...next }),
    default: () => ({}),
  }),
});

type State = typeof WorkflowState.State;

const APPROVED = 'approved';
const REJECTED = 'rejected';
const TRUE_BRANCH = 'true';
const FALSE_BRANCH = 'false';

export interface ApprovalDecision {
  approved: boolean;
  comment?: string;
}

/** Receives step progress, so the graph does not depend on how runs are stored. */
export interface StepRecorder {
  start(node: ParsedNode, input: unknown): Promise<void>;
  succeed(nodeId: string, output: unknown): Promise<void>;
  fail(nodeId: string, error: string): Promise<void>;
  wait(nodeId: string): Promise<void>;
}

export interface CompileOptions {
  ownerId: Types.ObjectId;
  checkpointer: BaseCheckpointSaver;
  steps: StepRecorder;
}

/** Internal node names. A prefix keeps user ids from colliding with state keys like "input". */
const graphNodeName = (id: string) => `node_${id}`;

function asText(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

/** Fills templates in the string values of tool arguments, leaving other types untouched. */
function renderArgs(args: Record<string, unknown>, values: TemplateValues) {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      typeof value === 'string' ? renderTemplate(value, values) : value,
    ]),
  );
}

type NodeOutcome = Partial<State>;

async function runLlmNode(
  node: Extract<ParsedNode, { type: 'llm' }>,
  state: State,
  config: LangGraphRunnableConfig,
  ownerId: Types.ObjectId,
  recorder: StepRecorder,
): Promise<NodeOutcome> {
  const prompt = renderTemplate(node.config.prompt, state);
  await recorder.start(node, { prompt });
  const model = await createChatModel(
    node.config.model ?? (await resolveDefaultModel(ownerId)),
    ownerId,
  );
  const system = node.config.systemPrompt
    ? [new SystemMessage(renderTemplate(node.config.systemPrompt, state))]
    : [];
  const response = await model.invoke([...system, new HumanMessage(prompt)], config);
  return { last: response.text, outputs: { [node.id]: response.text } };
}

async function runAgentNode(
  node: Extract<ParsedNode, { type: 'agent' }>,
  state: State,
  ownerId: Types.ObjectId,
  recorder: StepRecorder,
): Promise<NodeOutcome> {
  const input = renderTemplate(node.config.input, state);
  await recorder.start(node, { agentId: node.config.agentId, input });

  const agent = await Agent.findOne({ _id: node.config.agentId, ownerId });
  if (!agent) throw new AppError(400, 'AGENT_NOT_FOUND', 'The agent for this step was not found');

  // A workflow step is one self-contained task, so it does not use the agent's chat memory.
  const built = await buildAgentGraph(agent, { memory: false });
  try {
    const result = (await built.graph.invoke({ messages: [new HumanMessage(input)] })) as {
      messages: AIMessage[];
    };
    const text = result.messages.at(-1)?.text ?? '';
    return { last: text, outputs: { [node.id]: text } };
  } finally {
    await built.close();
  }
}

async function runToolNode(
  node: Extract<ParsedNode, { type: 'tool' }>,
  state: State,
  recorder: StepRecorder,
): Promise<NodeOutcome> {
  const args = renderArgs(node.config.args, state);
  await recorder.start(node, { tool: node.config.tool, args });
  const tool = getBuiltinTool(node.config.tool);
  if (!tool) throw new AppError(400, 'UNKNOWN_TOOL', `Unknown tool: ${node.config.tool}`);
  const text = asText(await tool.invoke(args));
  return { last: text, outputs: { [node.id]: text } };
}

async function runConditionNode(
  node: Extract<ParsedNode, { type: 'condition' }>,
  state: State,
  recorder: StepRecorder,
): Promise<NodeOutcome> {
  const source = renderTemplate(node.config.source, state);
  await recorder.start(node, { source, operator: node.config.operator, value: node.config.value });
  const passed = evaluateCondition(node.config, source);
  // Only the branch decision is stored, so the next node still sees the previous step's output.
  return { outputs: { [node.id]: passed ? TRUE_BRANCH : FALSE_BRANCH } };
}

async function runApprovalNode(
  node: Extract<ParsedNode, { type: 'human_approval' }>,
  state: State,
  recorder: StepRecorder,
): Promise<NodeOutcome> {
  const payload = { nodeId: node.id, message: node.config.message, context: state.last };
  await recorder.start(node, payload);
  // Throws to pause the graph. On resume the node runs again and this returns the decision.
  const decision = interrupt<typeof payload, ApprovalDecision>(payload);
  return { outputs: { [node.id]: decision.approved ? APPROVED : REJECTED } };
}

function createNodeRunner(node: ParsedNode, options: CompileOptions) {
  const { steps, ownerId } = options;

  const execute = (state: State, config: LangGraphRunnableConfig): Promise<NodeOutcome> => {
    switch (node.type) {
      case 'llm':
        return runLlmNode(node, state, config, ownerId, steps);
      case 'agent':
        return runAgentNode(node, state, ownerId, steps);
      case 'tool':
        return runToolNode(node, state, steps);
      case 'condition':
        return runConditionNode(node, state, steps);
      case 'human_approval':
        return runApprovalNode(node, state, steps);
    }
  };

  return async (state: State, config: LangGraphRunnableConfig): Promise<NodeOutcome> => {
    try {
      const outcome = await execute(state, config);
      await steps.succeed(node.id, outcome.outputs?.[node.id]);
      return outcome;
    } catch (error) {
      if (isGraphInterrupt(error)) {
        await steps.wait(node.id);
        throw error;
      }
      await steps.fail(node.id, errorMessage(error));
      throw error;
    }
  };
}

/** Picks the outgoing edges to follow after a branching node. Exported for routing tests. */
export function routeBranch(
  nodeId: string,
  outputs: Record<string, string>,
  edges: { target: string; sourceHandle?: string | null }[],
): string[] {
  const output = outputs[nodeId];
  const tookFalseBranch = output === FALSE_BRANCH || output === REJECTED;
  return edges
    .filter((edge) => (edge.sourceHandle === FALSE_BRANCH) === tookFalseBranch)
    .map((edge) => edge.target);
}

// Node names are only known at runtime, which StateGraph's name-tracking types cannot express.
interface LooseGraph {
  addNode(name: string, action: unknown): LooseGraph;
  addEdge(from: string, to: string): LooseGraph;
  addConditionalEdges(from: string, route: (state: State) => string[], targets: string[]): void;
  compile(options: { checkpointer: BaseCheckpointSaver }): unknown;
}

/** Compiles a parsed workflow into a LangGraph graph. */
export function compileWorkflowGraph(workflow: ParsedWorkflow, options: CompileOptions): unknown {
  const graph = new StateGraph(WorkflowState) as unknown as LooseGraph;

  for (const node of workflow.nodes) {
    graph.addNode(graphNodeName(node.id), createNodeRunner(node, options));
  }
  for (const entry of workflow.entryNodes) {
    graph.addEdge(START, graphNodeName(entry));
  }

  for (const node of workflow.nodes) {
    const name = graphNodeName(node.id);
    const edges = workflow.outgoing.get(node.id) ?? [];

    if (edges.length === 0) {
      graph.addEdge(name, END);
    } else if (node.type === 'condition' || node.type === 'human_approval') {
      const targets = [...new Set(edges.map((edge) => graphNodeName(edge.target))), END];
      graph.addConditionalEdges(
        name,
        (state) => {
          const chosen = routeBranch(node.id, state.outputs, edges).map(graphNodeName);
          return chosen.length > 0 ? chosen : [END];
        },
        targets,
      );
    } else {
      for (const edge of edges) graph.addEdge(name, graphNodeName(edge.target));
    }
  }

  return graph.compile({ checkpointer: options.checkpointer });
}
