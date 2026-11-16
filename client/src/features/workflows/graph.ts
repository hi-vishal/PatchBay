import type { Edge, Node } from '@xyflow/react';
import type { Workflow, WorkflowEdge, WorkflowNode, WorkflowNodeType } from '@/lib/types';

export interface StepData extends Record<string, unknown> {
  kind: WorkflowNodeType;
  label: string;
  config: Record<string, unknown>;
}

export type StepNode = Node<StepData, 'step'>;
export type CableEdge = Edge<Record<string, never>, 'cable'>;

/** Sensible starting config, so a dropped step can run after small edits. */
export const DEFAULT_CONFIG: Record<WorkflowNodeType, Record<string, unknown>> = {
  llm: { prompt: '{{last}}' },
  agent: { input: '{{last}}' },
  tool: { tool: 'calculator', args: { expression: '' } },
  condition: { source: '{{last}}', operator: 'contains', value: '' },
  human_approval: { message: 'Approve this step to continue.' },
};

export function toFlowNodes(nodes: WorkflowNode[]): StepNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: 'step',
    position: node.position ?? { x: 0, y: 0 },
    data: {
      kind: node.type,
      label: node.label ?? '',
      config: node.config ?? {},
    },
  }));
}

export function toFlowEdges(edges: WorkflowEdge[]): CableEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    type: 'cable',
  }));
}

export function toWorkflowGraph(
  nodes: StepNode[],
  edges: CableEdge[],
): Pick<Workflow, 'nodes' | 'edges'> {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.kind,
      label: node.data.label,
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      config: node.data.config,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
    })),
  };
}

/** A cable hangs between its jacks, sagging more the further apart they are. */
export function cablePath(sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const distance = Math.hypot(targetX - sourceX, targetY - sourceY);
  const sag = Math.min(90, 18 + distance * 0.16);
  const reach = Math.max(36, Math.abs(targetX - sourceX) * 0.35);
  const lowest = Math.max(sourceY, targetY) + sag;
  return `M ${sourceX} ${sourceY} C ${sourceX + reach} ${lowest}, ${targetX - reach} ${lowest}, ${targetX} ${targetY}`;
}

export function newNodeId(kind: WorkflowNodeType): string {
  return `${kind}-${crypto.randomUUID().slice(0, 8)}`;
}
