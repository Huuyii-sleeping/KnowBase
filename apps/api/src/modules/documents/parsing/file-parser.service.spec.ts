import { describe, expect, it, vi } from 'vitest';
import { FileParserService } from './file-parser.service';

function parserResult(parser: string) {
  return {
    markdown: `# ${parser}`,
    assets: [],
    ready: true,
    parser,
    warnings: [],
  };
}

describe('FileParserService', () => {
  it('dispatches by extension and supplies an asset upload context', async () => {
    const primary = { parse: vi.fn(async (_buffer, _fileName, context) => {
      await context.uploadAsset({
        fileName: 'image.png',
        data: Buffer.from('image'),
        contentType: 'image/png',
        type: 'image',
      });
      return parserResult('xlsx');
    }) };
    const assetUploader = { upload: vi.fn(async (_documentId, input) => ({
      type: input.type ?? 'attachment',
      objectKey: 'assets/image.png',
      url: '/object/image.png',
    })) };
    const fallback = { parse: vi.fn() };
    const service = new FileParserService(
      primary as any,
      {} as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      fallback as any,
      assetUploader as any,
    );

    const result = await service.parse(Buffer.from('file'), 'report.xlsx', 'document-1');

    expect(result.parser).toBe('xlsx');
    expect(assetUploader.upload).toHaveBeenCalledWith('document-1', expect.objectContaining({
      fileName: 'image.png',
    }));
    expect(fallback.parse).not.toHaveBeenCalled();
  });

  it('uses the fallback parser when the primary parser fails', async () => {
    const primary = { parse: vi.fn(async () => { throw new Error('primary failed'); }) };
    const fallback = { parse: vi.fn(async () => parserResult('officeparser-fallback')) };
    const service = new FileParserService(
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      fallback as any,
      { upload: vi.fn() } as any,
    );

    const result = await service.parse(Buffer.from('file'), 'report.docx', 'document-2');

    expect(result.parser).toBe('officeparser-fallback');
    expect(fallback.parse).toHaveBeenCalledOnce();
  });

  it('returns a failed parse result when both parsers fail', async () => {
    const primary = { parse: vi.fn(async () => { throw new Error('primary failed'); }) };
    const fallback = { parse: vi.fn(async () => { throw new Error('fallback failed'); }) };
    const service = new FileParserService(
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      fallback as any,
      { upload: vi.fn() } as any,
    );

    const result = await service.parse(Buffer.from('file'), 'report.pdf', 'document-3');

    expect(result.ready).toBe(false);
    expect(result.parser).toBe('failed');
    expect(result.error).toBe('fallback failed');
  });
});
