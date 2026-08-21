import { describe, expect, it, vi } from 'vitest';

const { transaction, session, driver } = vi.hoisted(() => {
  const transaction = { run: vi.fn().mockResolvedValue({ records: [] }) };
  const session = {
    executeWrite: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    executeRead: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    transaction,
    session,
    driver: { session: vi.fn(() => session), close: vi.fn().mockResolvedValue(undefined) },
  };
});

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => driver),
    auth: { basic: vi.fn() },
    int: (value: number) => value,
  },
}));

import { GraphIndexService } from './graph-index.service';

describe('GraphIndexService', () => {
  it('replaces chunks, mentions, entities, and relations in one write transaction', async () => {
    const service = new GraphIndexService({
      get: vi.fn((_key: string, fallback: unknown) => fallback),
    } as any);

    await service.replaceDocument(
      'document-1',
      2,
      [{ id: 'chunk-1', documentId: 'document-1', version: 2, chunkIndex: 0, content: 'text' }],
      [{ key: '产品:knowbase', name: 'KnowBase', type: '产品' }],
      [{ chunkId: 'chunk-1', entityKey: '产品:knowbase' }],
      [{ key: 'relation-1', sourceKey: '产品:knowbase', targetKey: '技术:ollama', type: '使用', chunkId: 'chunk-1' }],
    );

    expect(session.executeWrite).toHaveBeenCalledOnce();
    expect(transaction.run).toHaveBeenCalledWith(
      expect.stringContaining('MERGE (c)-[:MENTIONS]->(e)'),
      { mentions: [{ chunkId: 'chunk-1', entityKey: '产品:knowbase' }] },
    );
    expect(transaction.run).toHaveBeenCalledWith(
      expect.stringContaining('MERGE (source)-[r:RELATED_TO'),
      expect.objectContaining({
        documentId: 'document-1',
        relations: [expect.objectContaining({ type: '使用' })],
      }),
    );
  });

  it('returns no graph result when the user has no visible documents', async () => {
    const service = new GraphIndexService({
      get: vi.fn((_key: string, fallback: unknown) => fallback),
    } as any);

    await expect(service.searchRelated({
      query: 'KnowBase',
      allowedDocumentIds: [],
      maxHops: 2,
      limit: 20,
    })).resolves.toEqual([]);
    expect(session.executeRead).not.toHaveBeenCalled();
  });
});
