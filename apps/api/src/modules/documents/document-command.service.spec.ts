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

import { DocumentCommandService } from './document-command.service';
import { Document, DocumentParseStatus, DocumentStatus } from './entities/document.entity';

function makeFile(name = 'notes.txt'): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'text/plain',
    size: 5,
    destination: '',
    filename: name,
    path: '',
    buffer: Buffer.from('hello'),
    stream: undefined as any,
  };
}

function makeDocument(overrides: Partial<Document> = {}) {
  return {
    id: 'document-1',
    version: 1,
    status: DocumentStatus.PUBLISHED,
    parseStatus: DocumentParseStatus.READY,
    parseError: null,
    rejectionReason: 'old reason',
    submittedAt: new Date(),
    reviewedAt: new Date(),
    reviewedBy: 'admin-1',
    ...overrides,
  } as Document;
}

function makeService(overrides: Record<string, unknown> = {}) {
  const repository = {
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => value),
    findOne: vi.fn(async () => makeDocument()),
    delete: vi.fn(async () => undefined),
    ...overrides.repository,
  };
  const contentStore = {
    create: vi.fn(async () => undefined),
    deleteByContentId: vi.fn(async () => undefined),
    deleteByDocumentId: vi.fn(async () => undefined),
    ...overrides.contentStore,
  };
  const storage = {
    putObject: vi.fn(async () => undefined),
    removeObject: vi.fn(async () => undefined),
    ...overrides.storage,
  };
  const fileParser = {
    supports: vi.fn(() => true),
    parse: vi.fn(async () => ({
      markdown: '# notes\n',
      assets: [],
      ready: true,
      parser: 'text',
      warnings: [],
    })),
    ...overrides.fileParser,
  };
  return {
    service: new DocumentCommandService(
      repository as any,
      contentStore as any,
      storage as any,
      fileParser as any,
    ),
    repository,
    contentStore,
    storage,
    fileParser,
  };
}

describe('DocumentCommandService', () => {
  it('persists the original file, parsed content, and metadata', async () => {
    const { service, repository, contentStore, storage, fileParser } = makeService();

    const id = await service.create(makeFile(), { uploaderId: 'user-1' });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(storage.putObject).toHaveBeenCalledOnce();
    expect(fileParser.parse).toHaveBeenCalledOnce();
    expect(contentStore.create).toHaveBeenCalledWith(expect.objectContaining({
      documentId: id,
      parser: 'text',
      markdown: '# notes\n',
    }));
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it('cleans up storage and content when metadata persistence fails', async () => {
    const { service, contentStore, storage } = makeService({
      repository: { save: vi.fn(async () => { throw new Error('postgres failed'); }) },
    });

    await expect(service.create(makeFile(), { uploaderId: 'user-1' })).rejects.toThrow('postgres failed');
    expect(storage.removeObject).toHaveBeenCalledOnce();
    expect(contentStore.deleteByContentId).toHaveBeenCalledOnce();
  });

  it('returns a published document to draft when content is updated', async () => {
    const document = makeDocument({ version: 2 });
    const { service, repository, contentStore } = makeService({
      repository: { findOne: vi.fn(async () => document) },
    });

    await service.updateContent('document-1', { markdown: '# updated\n' });

    expect(document.version).toBe(3);
    expect(document.status).toBe(DocumentStatus.DRAFT);
    expect(document.parseStatus).toBe(DocumentParseStatus.READY);
    expect(document.parseError).toBeNull();
    expect(contentStore.create).toHaveBeenCalledWith(expect.objectContaining({
      version: 3,
      markdown: '# updated\n',
    }));
    expect(repository.save).toHaveBeenCalledWith(document);
  });

  it('resets review fields when published metadata changes', async () => {
    const document = makeDocument();
    const { service, repository } = makeService({
      repository: { findOne: vi.fn(async () => document) },
    });

    await service.updateMetadata('document-1', { title: 'New title' });

    expect(document.title).toBe('New title');
    expect(document.status).toBe(DocumentStatus.DRAFT);
    expect(document.rejectionReason).toBeNull();
    expect(document.reviewedBy).toBeNull();
    expect(repository.save).toHaveBeenCalledWith(document);
  });
});
