import { describe, expect, it } from 'vitest';
import { cablePath, newNodeId, toFlowEdges, toFlowNodes, toWorkflowGraph } from './graph';

describe('workflow graph conversion', () => {
  const nodes = [
    {
      id: 'a',
      type: 'condition' as const,
      label: 'Check',
      position: { x: 10, y: 20 },
      config: { operator: 'contains' },
    },
  ];
  const edges = [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'false' }];

  it('round-trips nodes and edges', () => {
    const graph = toWorkflowGraph(toFlowNodes(nodes), toFlowEdges(edges));
    expect(graph.nodes).toEqual(nodes);
    expect(graph.edges).toEqual(edges);
  });

  it('fills in missing optional fields', () => {
    const [node] = toFlowNodes([{ id: 'x', type: 'llm' }]);
    expect(node).toMatchObject({
      position: { x: 0, y: 0 },
      data: { kind: 'llm', label: '', config: {} },
    });
  });

  it('keeps an unlabeled edge handle as null', () => {
    const [edge] = toFlowEdges([{ id: 'e', source: 'a', target: 'b' }]);
    expect(edge?.sourceHandle).toBeNull();
  });

  it('rounds dragged positions before saving', () => {
    const [flowNode] = toFlowNodes(nodes);
    if (!flowNode) throw new Error('missing node');
    const graph = toWorkflowGraph([{ ...flowNode, position: { x: 1.6, y: 2.2 } }], []);
    expect(graph.nodes[0]?.position).toEqual({ x: 2, y: 2 });
  });
});

describe('cablePath', () => {
  it('starts and ends at the jacks', () => {
    const path = cablePath(0, 0, 200, 50);
    expect(path.startsWith('M 0 0 C')).toBe(true);
    expect(path.endsWith('200 50')).toBe(true);
  });

  it('sags below both ends', () => {
    const match = /C [-\d.]+ ([-\d.]+),/.exec(cablePath(0, 0, 200, 50));
    expect(Number(match?.[1])).toBeGreaterThan(50);
  });
});

describe('newNodeId', () => {
  it('is unique and names the kind', () => {
    expect(newNodeId('llm')).toMatch(/^llm-/);
    expect(newNodeId('llm')).not.toBe(newNodeId('llm'));
  });
});
