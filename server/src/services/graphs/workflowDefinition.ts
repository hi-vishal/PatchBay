import { z } from 'zod';
import { WORKFLOW_NODE_TYPES } from '../../models/shared.js';
import type { WorkflowNodeType } from '../../models/shared.js';
import { AppError } from '../../utils/errors.js';
import { objectId } from '../../utils/validation.js';
import { modelConfigSchema } from '../llm/modelConfig.js';
import { BUILTIN_TOOL_NAMES } from '../tools/names.js';

const CONDITION_OPERATORS = [
  'contains',
  'not_contains',
  'equals',
  'not_equals',
  'greater_than',
  'less_than',
  'is_empty',
  'not_empty',
] as const;

export const nodeConfigSchemas = {
  llm: z.object({
    prompt: z.string().min(1, 'A prompt is required').max(20_000),
    systemPrompt: z.string().max(20_000).optional(),
    model: modelConfigSchema.optional(),
  }),
  agent: z.object({
    agentId: objectId,
    input: z.string().max(20_000).default('{{last}}'),
  }),
  tool: z.object({
    tool: z.enum(BUILTIN_TOOL_NAMES),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
  condition: z.object({
    source: z.string().max(5_000).default('{{last}}'),
    operator: z.enum(CONDITION_OPERATORS),
    value: z.string().max(5_000).default(''),
  }),
  human_approval: z.object({
    message: z.string().max(2_000).default('Approve this step to continue.'),
  }),
} satisfies Record<WorkflowNodeType, z.ZodType>;

export type ConditionConfig = z.infer<typeof nodeConfigSchemas.condition>;

export type ParsedNode = {
  [T in WorkflowNodeType]: {
    id: string;
    type: T;
    label: string;
    config: z.infer<(typeof nodeConfigSchemas)[T]>;
  };
}[WorkflowNodeType];

export interface WorkflowDefinition {
  nodes: {
    id: string;
    type: string;
    label?: string | null;
    config?: unknown;
  }[];
  edges: { id: string; source: string; target: string; sourceHandle?: string | null }[];
}

export interface ParsedWorkflow {
  nodes: ParsedNode[];
  /** Outgoing edges per node id. */
  outgoing: Map<string, WorkflowDefinition['edges']>;
  entryNodes: string[];
}

function invalid(message: string): AppError {
  return new AppError(400, 'INVALID_WORKFLOW', message);
}

/** Checks a saved workflow is runnable. Drafts can be saved incomplete, so this runs on start. */
export function parseWorkflow(definition: WorkflowDefinition): ParsedWorkflow {
  if (definition.nodes.length === 0) throw invalid('Add at least one node before running.');

  const nodes = definition.nodes.map((node): ParsedNode => {
    const name = node.label || node.id;
    if (!(WORKFLOW_NODE_TYPES as readonly string[]).includes(node.type)) {
      throw invalid(`Node "${name}" has an unknown type: ${node.type}`);
    }
    const schema = nodeConfigSchemas[node.type as WorkflowNodeType];
    const config = schema.safeParse(node.config ?? {});
    if (!config.success) {
      const issue = config.error.issues[0];
      throw invalid(`Node "${name}": ${issue?.path.join('.') || 'config'} ${issue?.message ?? ''}`);
    }
    return {
      id: node.id,
      type: node.type,
      label: node.label ?? '',
      config: config.data,
    } as ParsedNode;
  });

  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) throw invalid('Node ids must be unique.');

  const outgoing = new Map<string, WorkflowDefinition['edges']>();
  const hasIncoming = new Set<string>();
  for (const edge of definition.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      throw invalid(`Edge ${edge.id} references a node that does not exist.`);
    }
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    hasIncoming.add(edge.target);
  }

  const entryNodes = nodes.filter((node) => !hasIncoming.has(node.id)).map((node) => node.id);
  if (entryNodes.length === 0) {
    throw invalid('The workflow needs a starting node with no incoming edges.');
  }
  return { nodes, outgoing, entryNodes };
}

export interface TemplateValues {
  input: string;
  last: string;
  outputs: Record<string, string>;
}

/** Fills {{input}}, {{last}} and {{nodes.<id>}}. Unknown placeholders become empty text. */
export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    if (key === 'input') return values.input;
    if (key === 'last') return values.last;
    if (key.startsWith('nodes.')) return values.outputs[key.slice('nodes.'.length)] ?? '';
    return '';
  });
}

/** Evaluates a condition with fixed operators. Workflows never run user-written expressions. */
export function evaluateCondition(config: ConditionConfig, source: string): boolean {
  const actual = source.trim();
  const expected = config.value.trim();
  switch (config.operator) {
    case 'contains':
      return actual.toLowerCase().includes(expected.toLowerCase());
    case 'not_contains':
      return !actual.toLowerCase().includes(expected.toLowerCase());
    case 'equals':
      return actual.toLowerCase() === expected.toLowerCase();
    case 'not_equals':
      return actual.toLowerCase() !== expected.toLowerCase();
    case 'greater_than':
      return Number(actual) > Number(expected);
    case 'less_than':
      return Number(actual) < Number(expected);
    case 'is_empty':
      return actual.length === 0;
    case 'not_empty':
      return actual.length > 0;
  }
}
