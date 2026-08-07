import { describe, expect, it, vi } from 'vitest';

vi.mock('../../documents/entities/document.entity', () => ({
  Document: class Document {},
  DocumentStatus: {
    DRAFT: 'DRAFT',
    PENDING_REVIEW: 'PENDING_REVIEW',
    PUBLISHED: 'PUBLISHED',
    REJECTED: 'REJECTED',
  },
}));

import { RagPipelineService } from './rag-pipeline.service';
import { DocumentStatus } from '../../documents/entities/document.entity';

describe('RagPipelineService', () => {
  it('embeds every markdown chunk and replaces the document vector index', async () => {
    const documentQuery = {
      findEntity: vi.fn().mockResolvedValue({
        id: 'document-1',
        contentId: 'content-1',
        version: 3,
        status: DocumentStatus.PUBLISHED,
      }),
    };
    const contentStore = {
      findByContentId: vi.fn().mockResolvedValue({ markdown: '# Knowledge' }),
    };
    const chunker = { split: vi.fn().mockResolvedValue(['# Knowledge', 'Details']) };
    const embedding = {
      embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]),
    };
    const vectorIndex = { replaceChunks: vi.fn().mockResolvedValue(undefined) };
    const service = new RagPipelineService(
      documentQuery as any,
      contentStore as any,
      chunker as any,
      embedding as any,
      vectorIndex as any,
    );

    await expect(service.rebuildDocument('document-1')).resolves.toEqual({ chunks: 2 });

    expect(embedding.embedDocuments).toHaveBeenCalledWith(['# Knowledge', 'Details']);
    expect(vectorIndex.replaceChunks).toHaveBeenCalledWith(
      'document-1',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'document-1:v3:c0',
          embedding: [0.1, 0.2],
          content: '# Knowledge',
        }),
        expect.objectContaining({
          id: 'document-1:v3:c1',
          embedding: [0.3, 0.4],
          content: 'Details',
        }),
      ]),
    );
  });
});
