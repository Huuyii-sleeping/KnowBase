import { describe, expect, it, vi } from 'vitest';

vi.mock('./schemas/document-content.schema', () => ({
  DocumentContent: class DocumentContent {},
}));

import { DocumentContentStore } from './document-content.store';

describe('DocumentContentStore', () => {
  it('persists Markdown content with a calculated character count', async () => {
    const saved: Record<string, unknown>[] = [];
    class FakeModel {
      [key: string]: unknown;

      constructor(input: Record<string, unknown>) {
        Object.assign(this, input);
      }

      async save() {
        saved.push(this);
      }
    }
    const service = new DocumentContentStore(FakeModel as any);

    await service.create({
      contentId: 'content-1',
      documentId: 'document-1',
      markdown: '# Hello',
      parser: 'markdown',
      warnings: [],
      version: 1,
      assets: [],
    });

    expect(saved[0]).toMatchObject({
      contentId: 'content-1',
      markdown: '# Hello',
      characterCount: 7,
    });
  });

  it('delegates content cleanup to MongoDB filters', async () => {
    const model = {
      deleteOne: vi.fn(async () => undefined),
      deleteMany: vi.fn(async () => undefined),
    };
    const service = new DocumentContentStore(model as any);

    await service.deleteByContentId('content-1');
    await service.deleteByDocumentId('document-1');

    expect(model.deleteOne).toHaveBeenCalledWith({ contentId: 'content-1' });
    expect(model.deleteMany).toHaveBeenCalledWith({ documentId: 'document-1' });
  });
});
