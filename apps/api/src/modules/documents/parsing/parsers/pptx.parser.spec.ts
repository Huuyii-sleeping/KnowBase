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
});
