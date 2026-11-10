import { describe, expect, it, vi } from 'vitest';
import { ElasticsearchSchema } from './elasticsearch-schema';
function fixture() {
  const indices = {
    exists: vi.fn().mockResolvedValue(false),
    create: vi.fn(),
    putMapping: vi.fn(),
  };
  return {
    indices,
    schema: new ElasticsearchSchema({ indices } as any, 'docs', 'chunks', 2),
  };
}
describe('ElasticsearchSchema', () => {
  it('creates keyword generation fields and the configured vector dimension', async () => {
    const { schema, indices } = fixture();
    await schema.chunks();
    expect(indices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mappings: {
          properties: expect.objectContaining({
            generation_id: { type: 'keyword' },
            embedding: expect.objectContaining({ dims: 2 }),
          }),
        },
      }),
    );
  });
  it('updates existing installations before writing generation identifiers', async () => {
    const { schema, indices } = fixture();
    indices.exists.mockResolvedValueOnce(true);
    await schema.document();
    expect(indices.putMapping).toHaveBeenCalledWith({
      index: 'docs',
      properties: { generation_id: { type: 'keyword' } },
    });
  });
  it('adds the CJK subfield to existing chunk mappings without changing the original analyzer or vector dimensions', async () => {
    const { schema, indices } = fixture();
    indices.exists.mockResolvedValueOnce(true);
    await schema.chunks();
    expect(indices.putMapping).toHaveBeenCalledWith({
      index: 'chunks',
      properties: {
        generation_id: { type: 'keyword' },
        content: {
          type: 'text',
          fields: { cjk: { type: 'text', analyzer: 'cjk' } },
        },
      },
    });
    expect(indices.create).not.toHaveBeenCalled();
  });

  it('accepts concurrent index creation but propagates unrelated failures', async () => {
    const { schema, indices } = fixture();
    indices.create.mockRejectedValueOnce({
      meta: { body: { error: { type: 'resource_already_exists_exception' } } },
    });
    await schema.chunks();
    expect(indices.putMapping).toHaveBeenCalledOnce();
    indices.create.mockRejectedValueOnce(new Error('cluster down'));
    await expect(schema.document()).rejects.toThrow('cluster down');
  });
  it('initializes once per index across concurrent readers and retries a failed initialization', async () => {
    const { schema, indices } = fixture();
    indices.exists.mockResolvedValue(true);
    indices.putMapping.mockRejectedValueOnce(new Error('cluster unavailable'));
    await expect(schema.chunks()).rejects.toThrow('cluster unavailable');
    await Promise.all([schema.chunks(), schema.chunks(), schema.chunks()]);
    await schema.chunks();
    expect(indices.exists).toHaveBeenCalledTimes(2);
    expect(indices.putMapping).toHaveBeenCalledTimes(2);
    await schema.document();
    expect(indices.exists).toHaveBeenCalledTimes(3);
  });
});
