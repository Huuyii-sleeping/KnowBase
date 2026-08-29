import { describe, expect, it } from 'vitest';
import type { GraphSearchPath } from '@/lib/api';
import { buildGraph } from './knowledge-graph-diagram';

describe('knowledge graph diagram', () => {
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

  it('merges paths into a radial graph with edges and a centered seed', () => {
    const graph = buildGraph(paths, paths[0]);

    expect(graph.seedLabel).toBe('RAG');
    expect(graph.nodes.find((node) => node.isSeed)?.key).toBe('概念:rag');
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(3);
    expect(graph.nodes.find((node) => node.key === '策略:hybrid')?.level).toBe(1);
    expect(graph.nodes.find((node) => node.key === '能力:graph')?.level).toBe(1);
    expect(graph.nodes.find((node) => node.key === '存储:neo4j')?.level).toBe(2);
    expect(graph.edges[0].d).toContain('Q');
  });
});
