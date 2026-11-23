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

import { DocumentQueryService } from './document-query.service';
import {
  DocumentStatus,
  DocumentParseStatus,
} from './entities/document.entity';

describe('DocumentQueryService', () => {
  it('loads PostgreSQL metadata and MongoDB content for a detail view', async () => {
    const document = {
      id: 'document-1',
      title: 'Knowledge',
      fileName: 'knowledge.md',
      mimeType: 'text/markdown',
      fileSize: '10',
      storageKey: 'original/document-1/knowledge.md',
      contentId: 'content-1',
      uploaderId: 'user-1',
      category: 'technical',
      team: 'platform',
      tags: ['api'],
      status: DocumentStatus.PUBLISHED,
      parseStatus: DocumentParseStatus.READY,
      parseError: null,
      rejectionReason: null,
      version: 1,
      permissions: {},
      statistics: { viewCount: 2, queryCount: 3 },
      submittedAt: null,
      reviewedAt: null,
      reviewedBy: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const repository = { findOne: vi.fn(async () => document) };
    const contentStore = {
      findByContentId: vi.fn(async () => ({
        contentId: 'content-1',
        markdown: '# Knowledge',
        parser: 'markdown',
        warnings: [],
        version: 1,
        assets: [],
        characterCount: 11,
        tables: [
          {
            id: 'table-1',
            schema: 'table-v1',
            cells: [{ row: 2, column: 1, text: '0' }],
          },
        ],
      })),
    };
    const service = new DocumentQueryService(
      repository as any,
      contentStore as any,
      { assertCanView: vi.fn() } as any,
    );

    const result = await service.findOne('document-1', true);

    expect(result).toMatchObject({
      id: 'document-1',
      title: 'Knowledge',
      fileSize: 10,
      content: {
        contentId: 'content-1',
        markdown: '# Knowledge',
        tables: [
          {
            id: 'table-1',
            schema: 'table-v1',
            cells: [{ row: 2, column: 1, text: '0' }],
          },
        ],
      },
    });
    expect(contentStore.findByContentId).toHaveBeenCalledWith('content-1');
  });

  it('does not load MongoDB content for metadata-only queries', async () => {
    const document = { id: 'document-1', contentId: 'content-1' };
    const repository = { findOne: vi.fn(async () => document) };
    const contentStore = { findByContentId: vi.fn() };
    const service = new DocumentQueryService(
      repository as any,
      contentStore as any,
      { assertCanView: vi.fn() } as any,
    );

    const result = await service.findOne('document-1');

    expect(result.content).toBeUndefined();
    expect(contentStore.findByContentId).not.toHaveBeenCalled();
  });

  it('checks access before reading table evidence and returns it only with content', async () => {
    const repository = {
      findOne: vi.fn(async () => ({ id: 'doc', contentId: 'body' })),
    };
    const tables = [{ id: 'table-1', source: { page: 2 }, cells: [] }];
    const contentStore = { findByContentId: vi.fn(async () => ({ tables })) };
    const access = {
      assertCanView: vi.fn(() => {
        throw new Error('forbidden');
      }),
    };
    const service = new DocumentQueryService(
      repository as any,
      contentStore as any,
      access as any,
    );
    const user = { id: 'user', role: 'USER' } as any;
    await expect(service.findOneForUser('doc', user, true)).rejects.toThrow(
      'forbidden',
    );
    expect(contentStore.findByContentId).not.toHaveBeenCalled();
    access.assertCanView.mockImplementation(() => undefined as never);
    expect(
      (await service.findOneForUser('doc', user, true)).content?.tables,
    ).toEqual(tables);
    expect((await service.findOneForUser('doc', user)).content).toBeUndefined();
    expect(contentStore.findByContentId).toHaveBeenCalledOnce();
  });
});
