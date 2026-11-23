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
import {
  Document,
  DocumentParseStatus,
  DocumentStatus,
} from './entities/document.entity';

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

function makeService(overrides: Record<string, Record<string, unknown>> = {}) {
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
    assertFileBudget: vi.fn(),
    parse: vi.fn(async () => ({
      markdown: '# notes\n',
      assets: [],
      ready: true,
      parser: 'text',
      warnings: [],
    })),
    ...overrides.fileParser,
  };
  const revisions = { updateContent: vi.fn(), updateMetadata: vi.fn() };
  const deletion = { remove: vi.fn() };
  const parseTasks = { enabled: false, create: vi.fn() };
  return {
    service: new DocumentCommandService(
      repository as any,
      contentStore as any,
      storage as any,
      fileParser as any,
      revisions as any,
      deletion as any,
      parseTasks as any,
    ),
    repository,
    contentStore,
    storage,
    fileParser,
    revisions,
    deletion,
    parseTasks,
  };
}

describe('DocumentCommandService', () => {
  it('submits asynchronous uploads atomically without parsing in the request', async () => {
    const f = makeService();
    f.parseTasks.enabled = true;
    await f.service.create(makeFile(), {}, { id: 'user-1' } as any);
    expect(f.parseTasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ parseStatus: 'PENDING', status: 'DRAFT' }),
    );
    expect(f.fileParser.parse).not.toHaveBeenCalled();
    expect(f.contentStore.create).not.toHaveBeenCalled();
    expect(f.repository.save).not.toHaveBeenCalled();
  });

  it('rejects an over-budget upload before persisting the original or queueing work', async () => {
    const f = makeService({
      fileParser: {
        assertFileBudget: vi.fn(() => {
          throw new Error('File exceeds ingestion byte budget');
        }),
      },
    });
    f.parseTasks.enabled = true;
    await expect(
      f.service.create(makeFile(), {}, { id: 'user-1' } as any),
    ).rejects.toThrow('byte budget');
    expect(f.storage.putObject).not.toHaveBeenCalled();
    expect(f.parseTasks.create).not.toHaveBeenCalled();
  });

  it('preserves the original when an asynchronous create COMMIT might have succeeded', async () => {
    const f = makeService();
    f.parseTasks.enabled = true;
    f.parseTasks.create.mockRejectedValueOnce(new Error('lost COMMIT reply'));
    await expect(
      f.service.create(makeFile(), {}, { id: 'user-1' } as any),
    ).rejects.toThrow('COMMIT');
    expect(f.storage.removeObject).not.toHaveBeenCalled();
  });
  it('persists the original file, parsed content, and metadata', async () => {
    const { service, repository, contentStore, storage, fileParser } =
      makeService();

    const id = await service.create(makeFile(), {}, { id: 'user-1' } as any);

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(storage.putObject).toHaveBeenCalledOnce();
    expect(fileParser.parse).toHaveBeenCalledOnce();
    expect(contentStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: id,
        parser: 'text',
        markdown: '# notes\n',
      }),
    );
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it('cleans up storage and content when metadata persistence fails', async () => {
    const { service, contentStore, storage } = makeService({
      repository: {
        save: vi.fn(async () => {
          throw new Error('postgres failed');
        }),
      },
    });

    await expect(
      service.create(makeFile(), {}, { id: 'user-1' } as any),
    ).rejects.toThrow('postgres failed');
    expect(storage.removeObject).toHaveBeenCalledOnce();
    expect(contentStore.deleteByContentId).toHaveBeenCalledOnce();
  });

  it('schedules extracted assets for durable cleanup when content persistence fails', async () => {
    const asset = {
      type: 'image',
      objectKey: 'assets/doc/image',
      url: '/image',
    };
    const discardAssets = vi.fn();
    const { service, contentStore, storage } = makeService({
      fileParser: {
        discardAssets,
        parse: vi.fn().mockResolvedValue({
          markdown: 'body',
          assets: [asset],
          ready: true,
          parser: 'docx',
          warnings: [],
        }),
      },
      contentStore: {
        create: vi.fn().mockRejectedValue(new Error('mongo offline')),
      },
    });
    await expect(
      service.create(makeFile(), {}, { id: 'user-1' } as any),
    ).rejects.toThrow('mongo offline');
    expect(discardAssets).toHaveBeenCalledWith(expect.any(String), [asset]);
    expect(storage.removeObject).toHaveBeenCalledOnce();
    expect(contentStore.deleteByContentId).toHaveBeenCalledOnce();
  });

  it('delegates revision and deletion commands to their transaction services', async () => {
    const { service, revisions, deletion } = makeService();
    await service.updateContent('doc', { markdown: '# new' });
    await service.updateMetadata('doc', { title: 'New' });
    await service.remove('doc');
    expect(revisions.updateContent).toHaveBeenCalledWith(
      'doc',
      { markdown: '# new' },
      undefined,
    );
    expect(revisions.updateMetadata).toHaveBeenCalledWith(
      'doc',
      { title: 'New' },
      undefined,
    );
    expect(deletion.remove).toHaveBeenCalledWith('doc', undefined);
  });

  it.each([
    [undefined, true, 'FILE_REQUIRED'],
    [makeFile('movie.mp4'), false, 'FILE_UNSUPPORTED'],
    [{ ...makeFile(), size: 0, buffer: Buffer.alloc(0) }, true, 'FILE_EMPTY'],
  ] as const)(
    'rejects invalid uploads before writing any data (%s)',
    async (file, supported, code) => {
      const { service, repository, contentStore, storage } = makeService({
        fileParser: { supports: vi.fn(() => supported) },
      });
      try {
        await service.create(file, {}, { id: 'user-1' } as any);
        expect.fail('must reject invalid upload');
      } catch (error) {
        expect(
          (error as { getResponse(): unknown }).getResponse(),
        ).toMatchObject({ code });
      }
      expect(storage.putObject).not.toHaveBeenCalled();
      expect(contentStore.create).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it.each([
    [true, undefined, 'READY'],
    [false, undefined, 'PENDING'],
    [false, 'parser internal detail', 'FAILED'],
  ])(
    'persists parsing outcome independently of creation success',
    async (ready, error, parseStatus) => {
      const { service, repository, storage } = makeService({
        fileParser: {
          parse: vi.fn(async () => ({
            markdown: '',
            assets: [],
            parser: 'test',
            warnings: [],
            ready,
            error,
          })),
        },
      });
      await expect(
        service.create(makeFile(), {}, { id: 'user-1' } as any),
      ).resolves.toMatch(/^[0-9a-f-]{36}$/);
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ parseStatus, status: 'DRAFT' }),
      );
      expect(storage.removeObject).not.toHaveBeenCalled();
    },
  );
});
