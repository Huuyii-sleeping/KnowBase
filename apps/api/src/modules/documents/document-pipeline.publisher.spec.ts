import { describe, expect, it, vi } from 'vitest';
vi.mock('./entities/document.entity', () => ({ Document: class Document {} }));
import { DocumentPipelinePublisher } from './document-pipeline.publisher';

function fixture() {
  const outbox = { enqueue: vi.fn(), enqueueStandalone: vi.fn() };
  const content = {
    findByContentId: vi.fn().mockResolvedValue({ markdown: '# Content' }),
  };
  const service = new DocumentPipelinePublisher(outbox as any, content as any);
  return { outbox, content, service };
}

describe('DocumentPipelinePublisher', () => {
  it('writes three versioned tasks with the supplied transaction manager', async () => {
    const { service, outbox } = fixture();
    const manager = {} as any;
    await service.publishDocument(
      { id: 'doc-1', contentId: 'content-1', version: 2 } as any,
      manager,
    );
    expect(outbox.enqueue).toHaveBeenCalledTimes(3);
    expect(outbox.enqueue).toHaveBeenNthCalledWith(
      1,
      manager,
      'document.index',
      expect.objectContaining({
        documentId: 'doc-1',
        version: 2,
        markdown: '# Content',
      }),
    );
    expect(outbox.enqueue).toHaveBeenNthCalledWith(
      2,
      manager,
      'document.rag.rebuild',
      expect.objectContaining({ documentId: 'doc-1', version: 2 }),
    );
    expect(outbox.enqueue).toHaveBeenNthCalledWith(
      3,
      manager,
      'document.kg.rebuild',
      expect.objectContaining({ documentId: 'doc-1', version: 2 }),
    );
  });
  it('does not enqueue when the source content is missing', async () => {
    const { service, outbox, content } = fixture();
    content.findByContentId.mockResolvedValueOnce(null);
    await expect(
      service.publishDocument({ contentId: 'missing' } as any, {} as any),
    ).rejects.toThrow('document content not found');
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
  it('persists KG deletion in the outbox', async () => {
    const { service, outbox } = fixture();
    await service.deleteGraph('doc-1');
    expect(outbox.enqueueStandalone).toHaveBeenCalledWith(
      'document.kg.delete',
      { type: 'DOCUMENT_GRAPH_DELETE', documentId: 'doc-1' },
    );
  });
});
