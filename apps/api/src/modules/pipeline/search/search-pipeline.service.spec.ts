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
    const progress = {
      start: vi.fn(),
      report: vi.fn(),
      finish: vi.fn(),
      prune: vi.fn(),
    };
    const service = new SearchPipelineService(
      index as any,
      generations as any,
      new IndexBuildService(generations as any, progress as any),
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
    expect(progress.report.mock.calls.map(([, ...event]) => event)).toEqual([
      ['index_write', 0, 1],
      ['index_write', 1, 1],
      ['activating', 0, 0],
    ]);
    generations.capture.mockResolvedValueOnce(null);
    await service.indexDocument(message);
    expect(index.indexDocument).toHaveBeenCalledOnce();
  });
});
