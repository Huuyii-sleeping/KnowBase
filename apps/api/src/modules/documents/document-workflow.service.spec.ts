import { describe, expect, it, vi } from 'vitest';

vi.mock('./entities/document.entity', () => ({
  Document: class Document {},
  DocumentParseStatus: { PENDING: 'PENDING', READY: 'READY', FAILED: 'FAILED' },
  DocumentStatus: {
    DRAFT: 'DRAFT',
    PENDING_REVIEW: 'PENDING_REVIEW',
    PUBLISHED: 'PUBLISHED',
    REJECTED: 'REJECTED',
  },
}));

import { DocumentWorkflowService } from './document-workflow.service';
import { Document, DocumentParseStatus, DocumentStatus } from './entities/document.entity';

function makeDocument(overrides: Partial<Document> = {}) {
  return {
    id: 'document-1',
    status: DocumentStatus.DRAFT,
    parseStatus: DocumentParseStatus.READY,
    rejectionReason: null,
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    ...overrides,
  } as Document;
}

describe('DocumentWorkflowService', () => {
  it('moves a ready draft to pending review', async () => {
    const document = makeDocument();
    const repository = {
      findOne: vi.fn(async () => document),
      save: vi.fn(async (value) => value),
    };
    const service = new DocumentWorkflowService(repository as any);

    await service.submitForReview('document-1');

    expect(document.status).toBe(DocumentStatus.PENDING_REVIEW);
    expect(document.submittedAt).toBeInstanceOf(Date);
    expect(repository.save).toHaveBeenCalledWith(document);
  });

  it('rejects a document that has not finished parsing', async () => {
    const document = makeDocument({ parseStatus: DocumentParseStatus.PENDING });
    const repository = { findOne: vi.fn(async () => document), save: vi.fn() };
    const service = new DocumentWorkflowService(repository as any);

    await expect(service.submitForReview('document-1')).rejects.toThrow('document parsing is not ready');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('requires a reason when an administrator rejects a document', async () => {
    const document = makeDocument({ status: DocumentStatus.PENDING_REVIEW });
    const repository = { findOne: vi.fn(async () => document), save: vi.fn() };
    const service = new DocumentWorkflowService(repository as any);

    await expect(service.review('document-1', {
      approved: false,
      reviewerId: 'admin-1',
    })).rejects.toThrow('reason is required');
  });

  it('publishes an approved document and records the reviewer', async () => {
    const document = makeDocument({ status: DocumentStatus.PENDING_REVIEW });
    const repository = {
      findOne: vi.fn(async () => document),
      save: vi.fn(async (value) => value),
    };
    const service = new DocumentWorkflowService(repository as any);

    await service.review('document-1', {
      approved: true,
      reviewerId: 'admin-1',
    });

    expect(document.status).toBe(DocumentStatus.PUBLISHED);
    expect(document.reviewedBy).toBe('admin-1');
    expect(document.reviewedAt).toBeInstanceOf(Date);
  });
});
