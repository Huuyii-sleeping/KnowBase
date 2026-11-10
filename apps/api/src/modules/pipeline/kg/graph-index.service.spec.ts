import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transaction, session, driver } = vi.hoisted(() => {
  const transaction = { run: vi.fn().mockResolvedValue({ records: [] }) };
  const session = {
    run: vi.fn().mockResolvedValue({ records: [] }),
    executeWrite: vi.fn(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
    executeRead: vi.fn(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    transaction,
    session,
    driver: {
      session: vi.fn(() => session),
      close: vi.fn().mockResolvedValue(undefined),
    },
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replaces chunks, mentions, entities, and relations in one write transaction', async () => {
    const service = new GraphIndexService(
      {
        get: vi.fn((_key: string, fallback: unknown) => fallback),
      } as any,
      {
        active: vi.fn().mockResolvedValue(['gen']),
        isDeleted: vi.fn().mockResolvedValue(true),
      } as any,
    );

    await service.stageDocument(
      'document-1',
      2,
      'gen',
      [
        {
          id: 'chunk-1',
          documentId: 'document-1',
          version: 2,
          chunkIndex: 0,
          content: 'text',
        },
      ],
      [{ key: '产品:knowbase', name: 'KnowBase', type: '产品' }],
      [{ chunkId: 'chunk-1', entityKey: '产品:knowbase' }],
      [
        {
          key: 'relation-1',
          sourceKey: '产品:knowbase',
          targetKey: '技术:ollama',
          type: '使用',
          chunkId: 'chunk-1',
        },
      ],
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
    const service = new GraphIndexService(
      {
        get: vi.fn((_key: string, fallback: unknown) => fallback),
      } as any,
      {
        active: vi.fn().mockResolvedValue(['gen']),
        isDeleted: vi.fn().mockResolvedValue(true),
      } as any,
    );

    await expect(
      service.searchRelated({
        query: 'KnowBase',
        allowedDocumentIds: [],
        maxHops: 2,
        limit: 20,
      }),
    ).resolves.toEqual([]);
    expect(session.executeRead).not.toHaveBeenCalled();
  });

  it('filters both seed mentions and every path relationship by active generations', async () => {
    const heads = { active: vi.fn().mockResolvedValue(['active-gen']) };
    const service = new GraphIndexService(
      { get: (_key: string, fallback: unknown) => fallback } as any,
      heads as any,
    );
    await service.searchRelated({
      query: 'KnowBase',
      allowedDocumentIds: ['doc'],
      maxHops: 2,
      limit: 10,
    });
    expect(heads.active).toHaveBeenCalledWith('kg', ['doc']);
    const [query, params] = transaction.run.mock.calls[0];
    expect(query).toContain('seedChunk.generationId IN $generations');
    expect(query).toContain('relation.generationId IN $generations');
    expect(params.generations).toEqual(['active-gen']);
  });

  it('deletes a document graph and orphaned knowledge entities', async () => {
    const service = new GraphIndexService(
      {
        get: vi.fn((_key: string, fallback: unknown) => fallback),
      } as any,
      {
        active: vi.fn().mockResolvedValue(['gen']),
        isDeleted: vi.fn().mockResolvedValue(true),
      } as any,
    );

    await service.deleteDocument('document-1');

    expect(session.executeWrite).toHaveBeenCalledOnce();
    expect(transaction.run).toHaveBeenCalledWith(
      expect.stringContaining(
        'MATCH ()-[r:RELATED_TO {documentId: $documentId}]-()',
      ),
      { documentId: 'document-1' },
    );
    expect(transaction.run).toHaveBeenCalledWith(
      expect.stringContaining(
        'MATCH (c:DocumentChunk {documentId: $documentId})',
      ),
      { documentId: 'document-1' },
    );
    expect(transaction.run).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (d:KnowledgeDocument {id: $documentId})'),
      { documentId: 'document-1' },
    );
  });
});
