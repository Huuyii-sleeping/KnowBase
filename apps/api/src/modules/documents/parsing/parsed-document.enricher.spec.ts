import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ParsedDocumentEnricher } from './parsed-document.enricher';
import { SupplementaryParsers } from './supplementary-parsers';
const parsed = () =>
  ({
    markdown: 'OCR',
    ready: true,
    parser: 'mineru',
    assets: [],
    warnings: [],
  }) as any;
it('supplements workbook evidence and preserves the review barrier when formulas are unknown', async () => {
  const xlsx = {
    extract: vi.fn(async () => ({
      evidence: [{ id: 'row' }],
      issues: [{ code: 'FORMULA_UNKNOWN', message: '核对公式' }],
    })),
  };
  const semantics = { enrich: vi.fn() };
  const result = parsed();
  await new ParsedDocumentEnricher(
    xlsx as any,
    {} as any,
    semantics as any,
  ).enrich(result, Buffer.from('xlsx'), '.xlsx', {} as any, new Map());
  expect(result.evidence[0].id).toBe('row');
  expect(result.ready).toBe(false);
  expect(result.quality.issues[0].code).toBe('FORMULA_UNKNOWN');
  xlsx.extract.mockRejectedValueOnce(new Error('broken archive'));
  await expect(
    new ParsedDocumentEnricher(xlsx as any, {} as any, semantics as any).enrich(
      parsed(),
      Buffer.from('x'),
      '.xlsx',
      {} as any,
      new Map(),
    ),
  ).rejects.toThrow('broken archive');
});
it('registers the original image as independent evidence before semantic enrichment', async () => {
  const result = parsed(),
    bytes = Buffer.from('image');
  const context = {
    uploadAsset: vi.fn(async () => ({
      objectKey: 'assets/doc/original',
      url: '/img',
      type: 'image',
    })),
  };
  const semantics = { enrich: vi.fn() };
  await new ParsedDocumentEnricher(
    {} as any,
    {} as any,
    semantics as any,
  ).enrich(result, bytes, '.jpg', context as any, new Map());
  expect(context.uploadAsset).toHaveBeenCalledWith(
    expect.objectContaining({ data: bytes, contentType: 'image/jpeg' }),
  );
  expect(result.evidence[0]).toMatchObject({
    kind: 'image',
    objectKeys: ['assets/doc/original'],
    data: { representation: 'original_image' },
  });
  expect(semantics.enrich).toHaveBeenCalledOnce();
});
it('routes only MinerU snapshot inputs and rejects retired media even with legacy configuration', () => {
  const web = {};
  const registry = new SupplementaryParsers(
    web as any,
    new ConfigService({
      DOCUMENT_PARSER: 'mineru',
      MEDIA_PYTHON: '/python',
      ASR_MODEL_PATH: '/model',
      ASR_MODEL_REVISION: 'fixed',
    }),
  );
  for (const extension of [
    '.wav',
    '.mp3',
    '.m4a',
    '.flac',
    '.ogg',
    '.mp4',
    '.mov',
    '.webm',
    '.mkv',
  ])
    expect(registry.get(extension)).toBeUndefined();
  expect(registry.get('.websnapshot')).toBe(web);
  expect(
    new SupplementaryParsers(
      web as any,
      new ConfigService({ DOCUMENT_PARSER: 'native' }),
    ).get('.websnapshot'),
  ).toBeUndefined();
});
