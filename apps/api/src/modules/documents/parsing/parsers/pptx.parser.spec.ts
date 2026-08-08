import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { PptxParser } from './pptx.parser';

describe('PptxParser', () => {
  it('extracts slide text from slide XML', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:p="x" xmlns:a="x"><a:t>Quarterly results</a:t></p:sld>',
    );

    const result = await new PptxParser().parse(
      await zip.generateAsync({ type: 'nodebuffer' }),
      'report.pptx',
      { documentId: 'test', uploadAsset: async () => { throw new Error('not expected'); } },
    );

    expect(result.parser).toBe('jszip+pptx-xml');
    expect(result.markdown).toContain('## Slide 1');
    expect(result.markdown).toContain('Quarterly results');
  });

  it('renders slide tables without leaking XML wrapper tags', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:p="x" xmlns:a="x"><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Metric</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Value</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Chunks</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:sld>',
    );

    const result = await new PptxParser().parse(
      await zip.generateAsync({ type: 'nodebuffer' }),
      'report.pptx',
      { documentId: 'test', uploadAsset: async () => { throw new Error('not expected'); } },
    );

    expect(result.markdown).toContain('| Metric | Value |');
    expect(result.markdown).toContain('| Chunks | 2     |');
    expect(result.markdown).not.toContain('<a:txBody>');
  });
});
