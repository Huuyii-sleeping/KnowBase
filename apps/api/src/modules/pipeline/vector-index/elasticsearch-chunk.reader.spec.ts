import { describe, expect, it, vi } from 'vitest';
import { ElasticsearchChunkReader } from './elasticsearch-chunk.reader';

function fixture(
  analyzer: 'standard' | 'cjk' = 'standard',
  contextual = false,
) {
  const search = vi.fn().mockResolvedValue({
    hits: {
      hits: [
        {
          _id: 'doc:v2:c1:active',
          _score: 7,
          _source: {
            document_id: 'doc',
            document_version: 2,
            chunk_index: 1,
            content: '关键证据',
            retrieval_text: '辅助标题\n关键证据',
          },
        },
      ],
    },
  });
  const active = vi.fn().mockResolvedValue(['active']);
  const chunks = vi.fn();
  return {
    search,
    active,
    chunks,
    reader: new ElasticsearchChunkReader(
      { search } as any,
      'chunks',
      { chunks } as any,
      { active } as any,
      analyzer,
      contextual,
    ),
  };
}

describe('ElasticsearchChunkReader', () => {
  it.each(['standard', 'cjk'] as const)(
    'searches enriched %s text but only returns original evidence',
    async (analyzer) => {
      const { reader, search } = fixture(analyzer, true);
      const results = await reader.keyword({ query: '辅助标题', topK: 5 });
      expect(results[0].content).toBe('关键证据');
      expect(results[0]).not.toHaveProperty('retrievalText');
      expect(search.mock.calls[0][0].query.bool).toEqual({
        must: [
          {
            match: {
              [analyzer === 'cjk' ? 'retrieval_text.cjk' : 'retrieval_text']: {
                query: '辅助标题',
              },
            },
          },
        ],
        filter: [{ terms: { generation_id: ['active'] } }],
      });
    },
  );
  it('returns original chunk bodies and identities from keyword matches in allowed active batches', async () => {
    const { reader, search, active } = fixture();
    expect(
      await reader.keyword({
        query: '  关键证据 ',
        topK: 5,
        allowedDocumentIds: ['doc'],
      }),
    ).toEqual([
      {
        id: 'doc:v2:c1:active',
        documentId: 'doc',
        version: 2,
        chunkIndex: 1,
        content: '关键证据',
        score: 7,
      },
    ]);
    expect(active).toHaveBeenCalledWith('rag', ['doc']);
    expect(search).toHaveBeenCalledWith({
      index: 'chunks',
      size: 5,
      query: {
        bool: {
          must: [{ match: { content: { query: '关键证据' } } }],
          filter: [{ terms: { generation_id: ['active'] } }],
        },
      },
    });
  });

  it('queries CJK bigrams only when explicitly enabled and retains the active generation filter', async () => {
    const { reader, search } = fixture('cjk');
    await reader.keyword({ query: '上传成功', topK: 10 });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          bool: {
            must: [{ match: { 'content.cjk': { query: '上传成功' } } }],
            filter: [{ terms: { generation_id: ['active'] } }],
          },
        },
      }),
    );
  });

  it('does not search for blank input or when the current revision or permissions leave no active batches', async () => {
    const { reader, search, active, chunks } = fixture();
    expect(await reader.keyword({ query: '   ', topK: 5 })).toEqual([]);
    expect(active).not.toHaveBeenCalled();
    active.mockResolvedValue([]);
    expect(
      await reader.keyword({ query: 'query', topK: 5, allowedDocumentIds: [] }),
    ).toEqual([]);
    expect(active).toHaveBeenCalledWith('rag', []);
    expect(chunks).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it('propagates store and search failures instead of presenting a false empty success', async () => {
    const { reader, search, active } = fixture();
    active.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(reader.keyword({ query: 'query', topK: 5 })).rejects.toThrow(
      'database unavailable',
    );
    expect(search).not.toHaveBeenCalled();
    search.mockRejectedValueOnce(new Error('search unavailable'));
    await expect(reader.keyword({ query: 'query', topK: 5 })).rejects.toThrow(
      'search unavailable',
    );
  });
});
