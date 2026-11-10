import { describe, expect, it, vi } from 'vitest';
import { ElasticsearchGenerationWriter } from './elasticsearch-generation.writer';

function fixture() {
  const client = {
    index: vi.fn().mockResolvedValue({}),
    bulk: vi.fn().mockResolvedValue({ errors: false }),
    indices: { exists: vi.fn().mockResolvedValue(true) },
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
      refresh: 'wait_for',
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
