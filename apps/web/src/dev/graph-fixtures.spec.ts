import { describe, expect, it } from 'vitest';
import { buildKnowledgeGraphData } from '@/lib/knowledge-graph-data';
import { complexPaths, graphScenarios } from './graph-fixtures';

describe('complex graph fixtures', () => {
  it('preserves cycles, self loops, opposite and parallel relationships', () => {
    const graph = buildKnowledgeGraphData(
      complexPaths,
      complexPaths[0],
      'Knowbase',
    );
    expect(graph.nodeCount).toBe(24);
    expect(graph.edgeCount).toBe(59);
    const edges = graph.data.edges!;
    expect(edges.some((edge) => edge.source === edge.target)).toBe(true);
    expect(
      edges.some((edge) => edge.source === 'lab:1' && edge.target === 'lab:2'),
    ).toBe(true);
    expect(
      edges.some((edge) => edge.source === 'lab:2' && edge.target === 'lab:1'),
    ).toBe(true);
    expect(
      edges.filter(
        (edge) => edge.source === 'lab:0' && edge.target === 'lab:1',
      ),
    ).toHaveLength(2);
    expect(
      graph.data.nodes?.find((node) => node.id === 'lab:0')?.data?.pathCount,
    ).toBe(20);
  });
  it('covers the API maximum and an additional larger stress case', () => {
    const wide = buildKnowledgeGraphData(graphScenarios.wide.paths, null);
    expect(wide.nodeCount).toBe(61);
    expect(wide.edgeCount).toBe(60);
    const stress = buildKnowledgeGraphData(graphScenarios.stress.paths, null);
    expect(stress.nodeCount).toBe(99);
    expect(stress.edgeCount).toBe(240);
  });
});
