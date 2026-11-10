import { describe, expect, it, vi } from 'vitest';
vi.mock('../../documents/entities/document.entity', () => ({
  Document: class {},
  DocumentStatus: { PUBLISHED: 'PUBLISHED' },
}));
import { RagPipelineService } from './rag-pipeline.service';
import { IndexBuildService } from '../../indexing/index-build.service';

function fixture() {
  const document = {
    id: 'doc',
    version: 3,
    contentId: 'body',
    status: 'PUBLISHED',
  };
  const generations = {
    capture: vi.fn().mockResolvedValue(document),
    activate: vi.fn().mockResolvedValue(true),
  };
  const content = {
    findByContentId: vi.fn().mockResolvedValue({ markdown: '# Source' }),
  };
  const chunker = { split: vi.fn().mockResolvedValue(['One', 'Two']) };
  const embedding = {
    embedDocuments: vi.fn().mockResolvedValue([[0.1], [0.2]]),
  };
  const index = {
    stageChunks: vi.fn(),
    discardGeneration: vi.fn(),
    deleteDocument: vi.fn(),
  };
  const service = new RagPipelineService(
    content as any,
    chunker as any,
    embedding as any,
    index as any,
    generations as any,
    new IndexBuildService(generations as any),
  );
  return { service, generations, content, chunker, embedding, index };
}
describe('RagPipelineService generations', () => {
  it('activates an empty batch without calling the embedding provider', async () => {
    const { service, chunker, embedding, index } = fixture();
    chunker.split.mockResolvedValueOnce([]);
    expect(await service.rebuildDocument('doc', 3)).toEqual({ chunks: 0 });
    expect(embedding.embedDocuments).not.toHaveBeenCalled();
    expect(index.stageChunks).toHaveBeenCalledWith(
      'doc',
      expect.any(String),
      [],
    );
  });
  it('stages all embeddings before activating a complete generation', async () => {
    const { service, index, generations } = fixture();
    expect(await service.rebuildDocument('doc', 3)).toEqual({ chunks: 2 });
    expect(generations.capture).toHaveBeenCalledWith('doc', 3);
    expect(index.stageChunks).toHaveBeenCalledWith('doc', expect.any(String), [
      expect.objectContaining({ id: 'doc:v3:c0', embedding: [0.1] }),
      expect.objectContaining({ id: 'doc:v3:c1', embedding: [0.2] }),
    ]);
    expect(generations.activate).toHaveBeenCalledWith(
      expect.objectContaining({ version: 3 }),
      'rag',
      index.stageChunks.mock.calls[0][1],
    );
  });
  it('skips obsolete messages before model calls', async () => {
    const { service, generations, embedding, index } = fixture();
    generations.capture.mockResolvedValueOnce(null);
    expect(await service.rebuildDocument('doc', 2)).toEqual({
      chunks: 0,
      skipped: true,
    });
    expect(embedding.embedDocuments).not.toHaveBeenCalled();
    expect(index.stageChunks).not.toHaveBeenCalled();
  });
  it('does not activate an invalid embedding batch', async () => {
    const { service, embedding, generations, index } = fixture();
    embedding.embedDocuments.mockResolvedValueOnce([[0.1]]);
    await expect(service.rebuildDocument('doc', 3)).rejects.toThrow(
      'embedding count',
    );
    expect(generations.activate).not.toHaveBeenCalled();
    expect(index.stageChunks).not.toHaveBeenCalled();
  });
  it('discards partial writes without changing the previous head', async () => {
    const { service, index, generations } = fixture();
    index.stageChunks.mockRejectedValueOnce(new Error('bulk failed'));
    await expect(service.rebuildDocument('doc', 3)).rejects.toThrow(
      'bulk failed',
    );
    expect(generations.activate).not.toHaveBeenCalled();
    expect(index.discardGeneration).toHaveBeenCalledWith(
      'rag',
      index.stageChunks.mock.calls[0][1],
    );
  });
  it('discards a build superseded during embedding or indexing', async () => {
    const { service, generations, index } = fixture();
    generations.activate.mockResolvedValueOnce(false);
    expect(await service.rebuildDocument('doc', 3)).toEqual({
      chunks: 0,
      skipped: true,
    });
    expect(index.discardGeneration).toHaveBeenCalled();
  });
});
