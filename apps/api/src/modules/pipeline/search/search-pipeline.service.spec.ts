import { describe, expect, it, vi } from 'vitest';
vi.mock('../../documents/entities/document.entity', () => ({
  Document: class {},
  DocumentStatus: { PUBLISHED: 'PUBLISHED' },
}));
import { SearchPipelineService } from './search-pipeline.service';
import { IndexBuildService } from '../../indexing/index-build.service';
describe('SearchPipelineService', () => {
  it('stages a snapshot and skips obsolete tasks', async () => {
    const index = { indexDocument: vi.fn(), discardGeneration: vi.fn() };
    const generations = {
      capture: vi.fn().mockResolvedValue({ id: 'doc', version: 2 }),
      activate: vi.fn().mockResolvedValue(true),
    };
    const service = new SearchPipelineService(
      index as any,
      generations as any,
      new IndexBuildService(generations as any),
    );
    const message = {
      type: 'DOCUMENT_INDEX',
      documentId: 'doc',
      version: 2,
      markdown: '# body',
      metadata: { title: 'New', id: 'wrong' },
    } as any;
    await service.indexDocument(message);
    expect(index.indexDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'doc',
        generation: expect.any(String),
        document: expect.objectContaining({ id: 'doc', document_version: 2 }),
      }),
    );
    generations.capture.mockResolvedValueOnce(null);
    await service.indexDocument(message);
    expect(index.indexDocument).toHaveBeenCalledOnce();
  });
});
