import { describe, expect, it, vi } from 'vitest';
import { ElasticsearchGenerationWriter } from './elasticsearch-generation.writer';

function fixture() {
  const client = {
    index: vi.fn().mockResolvedValue({}),
    bulk: vi.fn().mockResolvedValue({ errors: false }),
    indices: {
      exists: vi.fn().mockResolvedValue(true),
      refresh: vi.fn().mockResolvedValue({ _shards: { failed: 0 } }),
    },
    deleteByQuery: vi.fn().mockResolvedValue({}),
  };
  const schema = {
    document: vi.fn().mockResolvedValue(undefined),
    chunks: vi.fn().mockResolvedValue(undefined),
  };
  const writer = new ElasticsearchGenerationWriter(
    client as any,
    'documents',
    'chunks',
    schema as any,
  );
  return { client, schema, writer };
}

describe('ElasticsearchGenerationWriter', () => {
  const chunk = (index: number) => ({
    id: `doc:c${index}`,
    documentId: 'doc',
    version: 1,
    chunkIndex: index,
    content: 'body',
    embedding: [1, 2],
  });

  it('bounds requests by count and bytes and refreshes only after every batch', async () => {
    const { client, schema } = fixture();
    const writer = new ElasticsearchGenerationWriter(
      client as any,
      'documents',
      'chunks',
      schema as any,
      { maxChunks: 2, maxBytes: 500 },
    );
    await writer.stageChunks(
      'doc',
      'gen',
      Array.from({ length: 5 }, (_, i) => chunk(i)),
    );
    expect(client.bulk.mock.calls.length).toBeGreaterThan(2);
    for (const [request] of client.bulk.mock.calls) {
      expect(request.operations.length).toBeLessThanOrEqual(4);
      expect(
        request.operations.reduce(
          (sum: number, item: unknown) =>
            sum + Buffer.byteLength(JSON.stringify(item)) + 1,
          0,
        ),
      ).toBeLessThanOrEqual(500);
      expect(request.refresh).toBe(false);
    }
    expect(client.indices.refresh).toHaveBeenCalledOnce();
    expect(client.indices.refresh.mock.invocationCallOrder[0]).toBeGreaterThan(
      client.bulk.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('does not refresh or complete when a later batch fails, and rejects oversized single items', async () => {
    const { client, schema } = fixture();
    client.bulk
      .mockResolvedValueOnce({ errors: false })
      .mockResolvedValueOnce({ errors: true });
    const writer = new ElasticsearchGenerationWriter(
      client as any,
      'documents',
      'chunks',
      schema as any,
      { maxChunks: 1, maxBytes: 1000 },
    );
    await expect(
      writer.stageChunks('doc', 'gen', [chunk(0), chunk(1), chunk(2)]),
    ).rejects.toThrow('one or more chunks');
    expect(client.bulk).toHaveBeenCalledTimes(2);
    expect(client.indices.refresh).not.toHaveBeenCalled();
    await expect(
      writer.stageChunks('doc', 'gen', [
        { ...chunk(0), content: 'x'.repeat(1000) },
      ]),
    ).rejects.toThrow('ES_BULK_MAX_BYTES');
  });

  it('rejects a failed refresh barrier', async () => {
    const { writer, client } = fixture();
    client.indices.refresh.mockResolvedValueOnce({ _shards: { failed: 1 } });
    await expect(writer.stageChunks('doc', 'gen', [chunk(0)])).rejects.toThrow(
      'refresh failed',
    );
  });

  it('isolates document generations while preserving the business document ID', async () => {
    const { client, schema, writer } = fixture();
    await writer.indexDocument({
      id: 'doc',
      generation: 'new',
      document: { title: 'Title', id: 'wrong', generation_id: 'old' },
    });
    expect(schema.document).toHaveBeenCalledOnce();
    expect(client.index).toHaveBeenCalledWith({
      index: 'documents',
      id: 'doc:new',
      document: { title: 'Title', id: 'doc', generation_id: 'new' },
      refresh: 'wait_for',
    });
  });

  it('surfaces partial bulk failures and retries the same batch with identical IDs', async () => {
    const { client, writer } = fixture();
    client.bulk.mockResolvedValueOnce({ errors: true });
    const chunks = [
      {
        id: 'doc:v2:c0',
        documentId: 'doc',
        version: 2,
        chunkIndex: 0,
        content: 'body',
        embedding: [0.1],
      },
    ];
    await expect(writer.stageChunks('doc', 'new', chunks)).rejects.toThrow(
      'one or more chunks',
    );
    await writer.stageChunks('doc', 'new', chunks);
    expect(client.bulk).toHaveBeenLastCalledWith({
      refresh: false,
      operations: [
        { index: { _index: 'chunks', _id: 'doc:v2:c0:new' } },
        {
          generation_id: 'new',
          document_id: 'doc',
          document_version: 2,
          chunk_index: 0,
          content: 'body',
          embedding: [0.1],
        },
      ],
    });
    expect(client.bulk.mock.calls[0]).toEqual(client.bulk.mock.calls[1]);
    expect(client.deleteByQuery).not.toHaveBeenCalled();
  });

  it('prepares the schema without sending an empty bulk request', async () => {
    const { client, schema, writer } = fixture();
    await writer.stageChunks('doc', 'new', []);
    expect(schema.chunks).toHaveBeenCalledOnce();
    expect(client.bulk).not.toHaveBeenCalled();
  });

  it('discards only the specified generation and deletes documents by the correct business field', async () => {
    const { client, writer } = fixture();
    await writer.discardGeneration('rag', 'failed');
    await writer.deleteDocument('doc', 'search');
    await writer.deleteDocument('doc', 'rag');
    expect(client.deleteByQuery.mock.calls.map(([request]) => request)).toEqual(
      [
        {
          index: 'chunks',
          query: { term: { generation_id: 'failed' } },
          refresh: true,
        },
        { index: 'documents', query: { term: { id: 'doc' } }, refresh: true },
        {
          index: 'chunks',
          query: { term: { document_id: 'doc' } },
          refresh: true,
        },
      ],
    );
  });

  it.each([
    { failures: [{ reason: 'unavailable' }] },
    { version_conflicts: 1 },
    { timed_out: true },
  ])('rejects incomplete cleanup: %j', async (result) => {
    const { client, writer } = fixture();
    client.deleteByQuery.mockResolvedValue(result);
    await expect(writer.discardGeneration('search', 'failed')).rejects.toThrow(
      'cleanup was incomplete',
    );
  });

  it('treats an absent index as already cleaned up', async () => {
    const { client, writer } = fixture();
    client.indices.exists.mockResolvedValue(false);
    await writer.deleteDocument('doc', 'rag');
    expect(client.deleteByQuery).not.toHaveBeenCalled();
  });
});
