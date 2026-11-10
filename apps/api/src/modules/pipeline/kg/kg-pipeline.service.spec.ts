import { describe, expect, it, vi } from 'vitest';
vi.mock('../../documents/entities/document.entity', () => ({
  Document: class {},
  DocumentStatus: { PUBLISHED: 'PUBLISHED' },
}));
import { KgPipelineService } from './kg-pipeline.service';
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
  const chunker = { split: vi.fn().mockResolvedValue(['One']) };
  const extractor = {
    extract: vi
      .fn()
      .mockResolvedValue({ entities: [], mentions: [], relations: [] }),
  };
  const index = {
    stageDocument: vi.fn(),
    discardGeneration: vi.fn(),
    deleteDocument: vi.fn(),
  };
  const service = new KgPipelineService(
    content as any,
    chunker as any,
    extractor as any,
    index as any,
    generations as any,
    new IndexBuildService(generations as any),
  );
  return { service, generations, extractor, index };
}
describe('KgPipelineService generations', () => {
  it('uses generation-specific chunk IDs and activates only after the Neo4j transaction', async () => {
    const { service, index, extractor, generations } = fixture();
    expect(await service.rebuildDocument('doc', 3)).toEqual({
      chunks: 1,
      entities: 0,
      relations: 0,
    });
    const generation = index.stageDocument.mock.calls[0][2];
    expect(extractor.extract).toHaveBeenCalledWith([
      expect.objectContaining({ id: `doc:v3:c0:${generation}` }),
    ]);
    expect(generations.activate).toHaveBeenCalledWith(
      expect.objectContaining({ version: 3 }),
      'kg',
      generation,
    );
  });
  it('skips stale, deleted or unpublished source without extraction', async () => {
    const { service, generations, extractor } = fixture();
    generations.capture.mockResolvedValueOnce(null);
    expect(await service.rebuildDocument('doc', 2)).toMatchObject({
      skipped: true,
    });
    expect(extractor.extract).not.toHaveBeenCalled();
  });
  it('preserves the current head if extraction fails', async () => {
    const { service, extractor, generations, index } = fixture();
    extractor.extract.mockRejectedValueOnce(new Error('invalid extraction'));
    await expect(service.rebuildDocument('doc', 3)).rejects.toThrow(
      'invalid extraction',
    );
    expect(index.stageDocument).not.toHaveBeenCalled();
    expect(generations.activate).not.toHaveBeenCalled();
  });
  it('discards obsolete staged graphs after the final version check', async () => {
    const { service, generations, index } = fixture();
    generations.activate.mockResolvedValueOnce(false);
    expect(await service.rebuildDocument('doc', 3)).toMatchObject({
      skipped: true,
    });
    expect(index.discardGeneration).toHaveBeenCalledWith(
      'doc',
      index.stageDocument.mock.calls[0][2],
    );
  });
  it('delegates deletion to the guarded graph adapter', async () => {
    const { service, index } = fixture();
    await service.deleteDocument('doc');
    expect(index.deleteDocument).toHaveBeenCalledWith('doc');
  });
});
