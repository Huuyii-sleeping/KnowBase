import { describe, expect, it, vi } from 'vitest';

vi.mock('./entities/document.entity', () => ({
  Document: class Document {},
  DocumentStatus: {
    DRAFT: 'DRAFT',
    PENDING_REVIEW: 'PENDING_REVIEW',
    PUBLISHED: 'PUBLISHED',
    REJECTED: 'REJECTED',
  },
}));

import { DocumentPublishService } from './document-publish.service';
import { DocumentStatus } from './entities/document.entity';

describe('DocumentPublishService', () => {
  it('marks a pending document as published and dispatches the pipelines', async () => {
    const document = {
      id: 'document-1',
      status: DocumentStatus.PENDING_REVIEW,
      rejectionReason: 'old reason',
      reviewedAt: null,
      reviewedBy: null,
    };
    const repository = {
      findOne: vi.fn().mockResolvedValue(document),
      save: vi.fn().mockResolvedValue(document),
    };
    const publisher = { publishDocument: vi.fn().mockResolvedValue(undefined) };
    const service = new DocumentPublishService(repository as any, publisher as any, {
      assertCanReview: vi.fn(),
    } as any);

    await service.publish('document-1', { id: 'admin-1', role: 'ADMIN' } as any);

    expect(document.status).toBe(DocumentStatus.PUBLISHED);
    expect(document.reviewedBy).toBe('admin-1');
    expect(document.rejectionReason).toBeNull();
    expect(repository.save).toHaveBeenCalledWith(document);
    expect(publisher.publishDocument).toHaveBeenCalledWith('document-1');
  });

  it('does not publish a draft document', async () => {
    const repository = {
      findOne: vi.fn().mockResolvedValue({
        id: 'document-1',
        status: DocumentStatus.DRAFT,
      }),
      save: vi.fn(),
    };
    const publisher = { publishDocument: vi.fn() };
    const service = new DocumentPublishService(repository as any, publisher as any, {
      assertCanReview: vi.fn(),
    } as any);

    await expect(service.publish('document-1', { id: 'admin-1', role: 'ADMIN' } as any)).rejects.toThrow(
      'only pending documents can be published',
    );
    expect(publisher.publishDocument).not.toHaveBeenCalled();
  });
});
