import { describe, expect, it } from 'vitest';
import type { GraphSearchPath } from './api';
import { getGraphPathDocumentIds, getGraphPathNodeCount, getGraphPathRelationCount } from './graph-result.utils';

describe('graph result utilities', () => {
  const path: GraphSearchPath = {
    seed: { key: '技术:ollama', name: 'Ollama', type: '技术' },
    entities: [
      { key: '技术:ollama', name: 'Ollama', type: '技术' },
      { key: '模型:qwen', name: 'qwen2.5:0.5b', type: '模型' },
      { key: '产品:knowbase', name: 'KnowBase', type: '产品' },
    ],
    relations: [
      { key: 'r1', type: '调用', documentId: 'doc-1', chunkId: 'doc-1:v1:c0' },
      { key: 'r2', type: '支撑', documentId: 'doc-2', chunkId: 'doc-2:v2:c1' },
      { key: 'r3', type: '支撑', documentId: 'doc-1', chunkId: 'doc-1:v3:c2' },
    ],
  } as const;

  it('summarizes graph path size and source documents', () => {
    expect(getGraphPathNodeCount(path)).toBe(3);
    expect(getGraphPathRelationCount(path)).toBe(3);
    expect(getGraphPathDocumentIds(path)).toEqual(['doc-1', 'doc-2']);
  });
});
