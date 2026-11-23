import { describe, expect, it, vi } from 'vitest';

vi.mock('./schemas/document-content.schema', () => ({
  DocumentContent: class DocumentContent {},
}));

import { DocumentContentStore } from './document-content.store';

describe('DocumentContentStore', () => {
  it('persists canonical table cells and source evidence, but manual replacement does not inherit locations', async () => {
    const saved: any[] = [];
    class Model {
      constructor(input: any) {
        Object.assign(this, input);
      }
      async save() {
        saved.push(this);
      }
    }
    const service = new DocumentContentStore(Model as any);
    const markdown =
      '<table><tr><th colspan="2">预算</th></tr><tr><td>A</td><td>0</td></tr></table>';
    const input = {
      contentId: 'body',
      documentId: 'doc',
      markdown,
      parser: 'mineru',
      warnings: [],
      version: 1,
      assets: [],
    };
    await service.create({
      ...input,
      sections: [
        { start: 0, end: markdown.length, source: { page: 2, blockIndex: 4 } },
      ],
    });
    expect(saved[0].tables[0]).toMatchObject({
      schema: 'table-v1',
      rowCount: 2,
      columnCount: 2,
      source: { page: 2, blockIndex: 4 },
    });
    expect(saved[0].tables[0].cells[0].columnSpan).toBe(2);
    expect(saved[0].tables[0].cells.at(-1).text).toBe('0');
    expect(saved[0].blocks[0].table).toBeUndefined();
    await service.create({
      ...input,
      contentId: 'manual',
      parser: 'manual-markdown',
    });
    expect(saved[1].tables[0].source).toBeUndefined();
    expect(saved[1].blocks[0].tableId).toBe(saved[1].tables[0].id);
  });

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

  it('rejects excessive serialized expansion before writing and propagates persistence failures', async () => {
    const save = vi.fn(async () => {
      throw new Error('Mongo unavailable');
    });
    class Model {
      async save() {
        return save();
      }
    }
    const service = new DocumentContentStore(Model as any);
    const input = {
      contentId: 'body',
      documentId: 'doc',
      parser: 'manual-markdown',
      warnings: [],
      version: 1,
      assets: [],
    };
    // Markdown and its readable block text are both part of the BSON record.
    await expect(
      service.create({ ...input, markdown: 'x'.repeat(8 * 1024 * 1024) }),
    ).rejects.toThrow('record budget');
    expect(save).not.toHaveBeenCalled();
    await expect(
      service.create({ ...input, markdown: 'body' }),
    ).rejects.toThrow('Mongo unavailable');
    expect(save).toHaveBeenCalledOnce();
  });
});
