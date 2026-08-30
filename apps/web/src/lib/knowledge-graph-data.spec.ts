import { describe, expect, it } from 'vitest';
import type { GraphSearchPath } from './api';
import { buildKnowledgeGraphData } from './knowledge-graph-data';

describe('knowledge graph data', () => {
  const paths: GraphSearchPath[] = [
    {
      seed: { key: '概念:rag', name: 'RAG', type: '概念' },
      entities: [
        { key: '概念:rag', name: 'RAG', type: '概念' },
        { key: '策略:hybrid', name: '混合检索', type: '策略' },
      ],
      relations: [{ key: 'r1', type: '依赖', documentId: 'doc-1', chunkId: 'doc-1:v1:c0' }],
    },
    {
      seed: { key: '概念:rag', name: 'RAG', type: '概念' },
      entities: [
        { key: '概念:rag', name: 'RAG', type: '概念' },
        { key: '能力:graph', name: '知识图谱', type: '能力' },
        { key: '存储:neo4j', name: 'Neo4j', type: '存储' },
      ],
      relations: [
        { key: 'r2', type: '追加', documentId: 'doc-2', chunkId: 'doc-2:v1:c1' },
        { key: 'r3', type: '依赖', documentId: 'doc-2', chunkId: 'doc-2:v1:c2' },
      ],
    },
  ];

  it('merges paths into graph data with seeded and active states', () => {
    const graph = buildKnowledgeGraphData(paths, paths[0]);

    expect(graph.seedId).toBe('概念:rag');
    expect(graph.seedLabel).toBe('RAG');
    expect(graph.nodeCount).toBe(4);
    expect(graph.edgeCount).toBe(3);

    const nodes = graph.data.nodes ?? [];
    const edges = graph.data.edges ?? [];

    expect(nodes.find((node) => node.id === '概念:rag')?.states).toContain('active');
    expect(nodes.find((node) => node.id === '概念:rag')?.data?.isSeed).toBe(true);
    expect(nodes.find((node) => node.id === '能力:graph')?.data?.depth).toBe(1);
    expect(nodes.find((node) => node.id === '存储:neo4j')?.type).toBe('rect');
    expect(nodes.find((node) => node.id === '存储:neo4j')?.data?.size).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number)]));
    expect(nodes.find((node) => node.id === '概念:rag')?.data?.pathCount).toBe(2);
    expect(nodes.find((node) => node.id === '概念:rag')?.data?.relationCount).toBe(2);
    expect(graph.nodeOrder[0]).toBe('概念:rag');
    expect(edges.find((edge) => edge.id === '概念:rag::策略:hybrid::依赖')?.data?.documentIds).toEqual(['doc-1']);
    expect(edges.find((edge) => edge.id === '概念:rag::策略:hybrid::依赖')?.type).toBe('polyline');
    expect(edges.find((edge) => edge.id === '概念:rag::策略:hybrid::依赖')?.states).toContain('active');
    expect(edges.find((edge) => edge.id === '概念:rag::能力:graph::追加')?.states).toEqual([]);
  });

  it('uses the queried entity as the visual anchor when it appears inside returned paths', () => {
    const graph = buildKnowledgeGraphData(paths, paths[1], 'Neo4j');
    const nodes = graph.data.nodes ?? [];

    expect(graph.seedId).toBe('存储:neo4j');
    expect(graph.seedLabel).toBe('Neo4j');
    expect(nodes.find((node) => node.id === '存储:neo4j')?.data?.isSeed).toBe(true);
    expect(nodes.find((node) => node.id === '存储:neo4j')?.data?.depth).toBe(0);
    expect(nodes.find((node) => node.id === '能力:graph')?.data?.depth).toBe(1);
  });
});
