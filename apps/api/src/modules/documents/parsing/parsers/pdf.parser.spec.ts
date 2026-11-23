import { describe, expect, it, vi } from 'vitest';
const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('pdf-parse', () => ({ default: parse }));
import { PdfParser } from './pdf.parser';
import { pdfPageMarkdown, renderPdfText } from './pdf-text';

const context = { documentId: 'doc', uploadAsset: vi.fn() };

describe('PDF quality and order', () => {
  it('retains interleaved prose and tables including an isolated tabular line', () => {
    const output = pdfPageMarkdown('before\nName\tValue\nA\t1\nafter\nB\t2');
    expect(output.indexOf('before')).toBeLessThan(output.indexOf('| Name'));
    expect(output.indexOf('| A')).toBeLessThan(output.indexOf('after'));
    expect(output).toContain('B 2');
  });

  it('uses real glyph widths and line boundaries when rebuilding text', () => {
    expect(
      renderPdfText([
        { str: 'A', transform: [1, 0, 0, 1, 10, 100], width: 50 },
        { str: 'B', transform: [1, 0, 0, 1, 65, 100], width: 10, hasEOL: true },
        { str: 'C', transform: [1, 0, 0, 1, 10, 90] },
      ]),
    ).toBe('A B\nC');
  });

  it('isolates the Buffer and annotates page positions', async () => {
    parse.mockImplementationOnce(async (input, options) => {
      expect(input).toBeInstanceOf(Uint8Array);
      expect(Buffer.isBuffer(input)).toBe(false);
      await options.pagerender({
        pageNumber: 1,
        getTextContent: async () => ({ items: [{ str: 'Page body.' }] }),
      });
      return { numpages: 1, text: 'Page body.' };
    });
    const result = await new PdfParser().parse(
      Buffer.from('pdf'),
      'page.pdf',
      context,
    );
    expect(result.ready).toBe(true);
    expect(result.sections).toHaveLength(1);
    expect(
      result.markdown.slice(result.sections![0].start, result.sections![0].end),
    ).toContain('Page body.');
  });

  it.each([false, true])(
    'does not mark blank or silently skipped pages READY (%s)',
    async (invoke) => {
      parse.mockImplementationOnce(async (_input, options) => {
        if (invoke)
          await options.pagerender({
            pageNumber: 1,
            getTextContent: async () => ({ items: [] }),
          });
        return { numpages: 2, text: '' };
      });
      const result = await new PdfParser().parse(
        Buffer.from('pdf'),
        'blank.pdf',
        context,
      );
      expect(result.ready).toBe(false);
      expect(result.error).toContain('pages 1, 2');
      expect(result.sections).toHaveLength(2);
    },
  );
});
