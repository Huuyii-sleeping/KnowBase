import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { FileParserService } from './file-parser.service';
import { SupplementaryParsers } from './supplementary-parsers';

function parserResult(parser: string) {
  return {
    markdown: `# ${parser}\n\nBody`,
    assets: [],
    ready: true,
    parser,
    warnings: [],
  };
}

describe('FileParserService', () => {
  it('rejects all retired audio/video formats before parsing or uploading, even with legacy runtime settings', async () => {
    const parser = { parse: vi.fn() };
    const uploader = { upload: vi.fn(), discard: vi.fn() };
    const config = new ConfigService({
      DOCUMENT_PARSER: 'mineru',
      MEDIA_PYTHON: '/legacy/python',
      ASR_MODEL_PATH: '/legacy/model',
      ASR_MODEL_REVISION: 'fixed',
      ASR_LANGUAGE: 'invalid-retired-setting',
    });
    const service = new FileParserService(
      parser as any,
      parser as any,
      parser as any,
      parser as any,
      parser as any,
      parser as any,
      parser as any,
      uploader as any,
      parser as any,
      config,
      new SupplementaryParsers(parser as any, config),
    );
    for (const ext of [
      'wav',
      'mp3',
      'm4a',
      'flac',
      'ogg',
      'mp4',
      'mov',
      'webm',
      'mkv',
    ]) {
      const name = `recording.${ext.toUpperCase()}`;
      expect(service.supports(name)).toBe(false);
      await expect(
        service.parse(Buffer.from('media'), name, 'doc'),
      ).rejects.toThrow('Unsupported file type');
    }
    expect(parser.parse).not.toHaveBeenCalled();
    expect(uploader.upload).not.toHaveBeenCalled();
  });
  it('cleans uploaded assets when a remote result contains an unsupported table', async () => {
    const asset = {
      type: 'attachment',
      objectKey: 'assets/doc/raw.json',
      url: '/raw',
    };
    const uploader = { upload: vi.fn(async () => asset), discard: vi.fn() };
    const remote = {
      parse: vi.fn(async (_buffer, _name, context) => {
        await context.uploadAsset({
          fileName: 'raw.json',
          contentType: 'application/json',
          data: Buffer.from('{}'),
        });
        return {
          ...parserResult('mineru'),
          markdown: '<table><tr><td colspan="0">unsupported</td></tr></table>',
        };
      }),
    };
    const unused = { parse: vi.fn() };
    const service = new FileParserService(
      unused as any,
      unused as any,
      unused as any,
      unused as any,
      unused as any,
      unused as any,
      unused as any,
      uploader as any,
      remote as any,
    );
    const result = await service.parse(
      Buffer.from('file'),
      'report.html',
      'doc',
    );
    expect(result.ready).toBe(false);
    expect(result.assets).toEqual([]);
    expect(uploader.discard).toHaveBeenCalledWith('doc', [asset]);
    expect(unused.parse).not.toHaveBeenCalled();
    await expect(
      service.parse(Buffer.from('file'), 'report.html', 'doc', {
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('span');
  });
  it('defaults binary documents to MinerU and keeps TXT/MD local', async () => {
    const native = { parse: vi.fn(async () => parserResult('text')) };
    const remote = { parse: vi.fn(async () => parserResult('mineru')) };
    const fallback = { parse: vi.fn() };
    const service = new FileParserService(
      native as any,
      native as any,
      native as any,
      native as any,
      native as any,
      native as any,
      fallback as any,
      { discard: vi.fn() } as any,
      remote as any,
    );
    for (const name of [
      'a.pdf',
      'a.docx',
      'a.pptx',
      'a.xlsx',
      'a.png',
      'a.jpg',
      'a.jpeg',
      'a.webp',
      'a.doc',
      'a.xls',
      'a.ppt',
      'a.html',
      'a.htm',
    ]) {
      expect(
        (await service.parse(Buffer.from('file'), name, 'doc')).parser,
      ).toBe('mineru');
    }
    expect(
      (await service.parse(Buffer.from('body'), 'a.txt', 'doc')).parser,
    ).toBe('text');
    expect(
      (await service.parse(Buffer.from('body'), 'a.md', 'doc')).parser,
    ).toBe('text');
    expect(remote.parse).toHaveBeenCalledTimes(13);
    expect(native.parse).toHaveBeenCalledTimes(2);
    expect(fallback.parse).not.toHaveBeenCalled();
  });

  it('rejects unsupported inputs and does not advertise MinerU-only formats in native mode', async () => {
    const parser = { parse: vi.fn() };
    const make = (mode: string) =>
      new FileParserService(
        parser as any,
        parser as any,
        parser as any,
        parser as any,
        parser as any,
        parser as any,
        parser as any,
        { discard: vi.fn() } as any,
        parser as any,
        new ConfigService({ DOCUMENT_PARSER: mode }),
      );
    const mineru = make('mineru');
    for (const name of ['audio.mp3', 'video.mp4', 'archive.zip', 'a.doc.exe']) {
      expect(mineru.supports(name)).toBe(false);
      await expect(
        mineru.parse(Buffer.from('file'), name, 'doc'),
      ).rejects.toThrow('Unsupported file type');
    }
    const native = make('native');
    for (const name of ['a.doc', 'a.xls', 'a.ppt', 'a.html', 'a.htm', 'a.png'])
      expect(native.supports(name)).toBe(false);
    expect(native.supports('a.DOCX')).toBe(true);
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('keeps default remote failures visible and skips native fallback', async () => {
    const native = { parse: vi.fn() };
    const fallback = { parse: vi.fn() };
    const remote = {
      parse: vi.fn().mockRejectedValue(new Error('MinerU unavailable')),
    };
    const service = new FileParserService(
      native as any,
      native as any,
      native as any,
      native as any,
      native as any,
      native as any,
      fallback as any,
      { discard: vi.fn() } as any,
      remote as any,
    );
    const result = await service.parse(Buffer.from('file'), 'a.pdf', 'doc');
    expect(result.ready).toBe(false);
    expect(result.quality?.status).toBe('failed');
    await expect(
      service.parse(Buffer.from('file'), 'a.pdf', 'doc', {}),
    ).rejects.toThrow('MinerU unavailable');
    expect(fallback.parse).not.toHaveBeenCalled();
    expect(native.parse).not.toHaveBeenCalled();
  });

  it('schedules only failed-attempt assets for cleanup and adopts fallback assets', async () => {
    let sequence = 0;
    const uploader = {
      upload: vi.fn(async () => ({
        type: 'image' as const,
        objectKey: `assets/doc/${++sequence}.png`,
        url: `/image/${sequence}`,
      })),
      discard: vi.fn(),
    };
    const primary = {
      parse: vi.fn(async (_buffer, _fileName, context) => {
        await context.uploadAsset({
          fileName: 'image.png',
          data: Buffer.from('image'),
          contentType: 'image/png',
        });
        throw new Error('broken parser');
      }),
    };
    const fallback = {
      parse: vi.fn(async (_buffer, _fileName, context) => {
        await context.uploadAsset({
          fileName: 'image.png',
          data: Buffer.from('image'),
          contentType: 'image/png',
        });
        return parserResult('fallback');
      }),
    };
    const service = new FileParserService(
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      fallback as any,
      uploader as any,
      undefined,
      new ConfigService({ DOCUMENT_PARSER: 'native' }),
    );
    const result = await service.parse(Buffer.from('file'), 'test.docx', 'doc');
    expect(uploader.discard).toHaveBeenCalledWith('doc', [
      expect.objectContaining({ objectKey: 'assets/doc/1.png' }),
    ]);
    expect(result.assets).toEqual([
      expect.objectContaining({ objectKey: 'assets/doc/2.png' }),
    ]);
    expect(result.parseStrategy).toBe('structured-markdown-v1');
    expect(result.blocks?.at(-1)?.kind).toBe('paragraph');
  });

  it('does not hide invalid text behind an Office fallback and rejects empty parser output', async () => {
    const primary = {
      parse: vi
        .fn()
        .mockRejectedValueOnce(new Error('encoding invalid'))
        .mockResolvedValueOnce({
          ...parserResult('empty'),
          markdown: '# Empty',
        }),
    };
    const fallback = { parse: vi.fn() };
    const service = new FileParserService(
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      fallback as any,
      { discard: vi.fn() } as any,
      undefined,
      new ConfigService({ DOCUMENT_PARSER: 'native' }),
    );
    expect(
      (await service.parse(Buffer.from('file'), 'test.txt', 'doc')).ready,
    ).toBe(false);
    expect(fallback.parse).not.toHaveBeenCalled();
    expect(
      (await service.parse(Buffer.from('file'), 'test.md', 'doc')).ready,
    ).toBe(false);
  });

  it('dispatches by extension and supplies an asset upload context', async () => {
    const primary = {
      parse: vi.fn(async (_buffer, _fileName, context) => {
        await context.uploadAsset({
          fileName: 'image.png',
          data: Buffer.from('image'),
          contentType: 'image/png',
          type: 'image',
        });
        return parserResult('xlsx');
      }),
    };
    const assetUploader = {
      discard: vi.fn(),
      upload: vi.fn(async (_documentId, input) => ({
        type: input.type ?? 'attachment',
        objectKey: 'assets/image.png',
        url: '/object/image.png',
      })),
    };
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
      undefined,
      new ConfigService({ DOCUMENT_PARSER: 'native' }),
    );

    const result = await service.parse(
      Buffer.from('file'),
      'report.xlsx',
      'document-1',
    );

    expect(result.parser).toBe('xlsx');
    expect(assetUploader.upload).toHaveBeenCalledWith(
      'document-1',
      expect.objectContaining({
        fileName: 'image.png',
      }),
    );
    expect(fallback.parse).not.toHaveBeenCalled();
  });

  it('uses the fallback parser when the primary parser fails', async () => {
    const primary = {
      parse: vi.fn(async () => {
        throw new Error('primary failed');
      }),
    };
    const fallback = {
      parse: vi.fn(async () => parserResult('officeparser-fallback')),
    };
    const service = new FileParserService(
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      fallback as any,
      { upload: vi.fn(), discard: vi.fn() } as any,
      undefined,
      new ConfigService({ DOCUMENT_PARSER: 'native' }),
    );

    const result = await service.parse(
      Buffer.from('file'),
      'report.docx',
      'document-2',
    );

    expect(result.parser).toBe('officeparser-fallback');
    expect(fallback.parse).toHaveBeenCalledOnce();
  });

  it('returns a failed parse result when both parsers fail', async () => {
    const primary = {
      parse: vi.fn(async () => {
        throw new Error('primary failed');
      }),
    };
    const fallback = {
      parse: vi.fn(async () => {
        throw new Error('fallback failed');
      }),
    };
    const service = new FileParserService(
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      primary as any,
      fallback as any,
      { upload: vi.fn(), discard: vi.fn() } as any,
      undefined,
      new ConfigService({ DOCUMENT_PARSER: 'native' }),
    );

    const result = await service.parse(
      Buffer.from('file'),
      'report.pdf',
      'document-3',
    );

    expect(result.ready).toBe(false);
    expect(result.parser).toBe('failed');
    expect(result.error).toBe('fallback failed');
  });
});
