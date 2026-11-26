import { describe, expect, it } from 'vitest';
import { PdfTableNormalizer } from './pdf-table-normalizer';
const header =
  '| Stage | Amount (CNY) | Status |\n| --- | --- | --- |\n| Deposit | 360000 | Approved |';
const continuation =
  '| Final acceptance | 240000 | Not approved |\n| --- | --- | --- |\n| Refund | -22500 | Confirmed |';
const title = ['Table 2. Supplier schedule'];
const next = ['Table 2. Supplier schedule (continued)'];

describe('PDF table structure normalization', () => {
  it('escapes OCR captions and cells while retaining blank values and mandatory review', () => {
    const result = new PdfTableNormalizer().normalize(
      '```\n       A&B\nName      Value\nA         -001.20元\nB         +0.00元\nC\n```',
      [],
      1,
      1,
    );
    expect(result.content).toContain('<caption>A&amp;B</caption>');
    expect(result.content).toContain('<td>-001.20元</td>');
    expect(result.content).toContain('<td>+0.00元</td>');
    expect(result.content).toContain('<td>C</td><td></td>');
    expect(result.issues[0].code).toBe('PDF_TABLE_ALIGNED_TEXT_REVIEW');
  });
  it('preserves native tables and keeps repeated-header pages independent', () => {
    const normalizer = new PdfTableNormalizer();
    expect(normalizer.normalize(header, title, 1, 1)).toEqual({
      content: header,
      issues: [],
    });
    expect(normalizer.normalize(header, next, 2, 1)).toEqual({
      content: header,
      issues: [],
    });
  });
  it('retains the first data row and negative values when carrying an explicitly continued header', () => {
    const normalizer = new PdfTableNormalizer();
    normalizer.normalize(header, title, 1, 1);
    const result = normalizer.normalize(continuation, next, 2, 1);
    expect(result.content).toContain('| Stage | Amount (CNY) | Status |');
    expect(result.content).toContain(
      '| Final acceptance | 240000 | Not approved |',
    );
    expect(result.content).toContain('| Refund | -22500 | Confirmed |');
    expect(result.headerPage).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'PDF_TABLE_HEADER_CARRIED',
    ]);
    expect(normalizer.normalize(continuation, next, 3, 1).headerPage).toBe(1);
  });
  it('converts only consistently aligned complete OCR grids and always requests review', () => {
    const normalizer = new PdfTableNormalizer();
    const text =
      '```\nStage       Amount  Status\nDeposit     360000  Approved\nRefund      -22500  Confirmed\n```';
    const result = normalizer.normalize(text, title, 1, 1);
    expect(result.content).toContain('| Refund | -22500 | Confirmed |');
    expect(result.issues[0].code).toBe('PDF_TABLE_ALIGNED_TEXT_REVIEW');
    for (const content of [
      '```\nStage Amount Status\nDeposit 360000 Approved\n```',
      '```\nStage       Amount  Status\nDeposit     360000\n```',
      '```\nStage       Amount  Status\nDeposit  360000  Approved\n```',
      '<table><tr><th colspan="2">A</th></tr><tr><td>1</td><td>2</td></tr></table>',
    ]) {
      expect(normalizer.normalize(content, title, 1, 1)).toEqual({
        content,
        issues: [
          expect.objectContaining({ code: 'PDF_TABLE_STRUCTURE_REVIEW' }),
        ],
      });
    }
  });
  it.each([
    { captions: ['Table 3. Different costs (continued)'], page: 2, count: 1 },
    { captions: next, page: 3, count: 1 },
    { captions: next, page: 2, count: 2 },
    { captions: ['Table 2. Supplier schedule'], page: 2, count: 1 },
  ])(
    'never borrows from unrelated, nonadjacent, ambiguous or unmarked tables: %j',
    ({ captions, page, count }) => {
      const normalizer = new PdfTableNormalizer();
      normalizer.normalize(header, title, 1, 1);
      const result = normalizer.normalize(continuation, captions, page, count);
      expect(result.content).toBe(continuation);
      expect(result.headerPage).toBeUndefined();
    },
  );
  it('does not carry over a header after unsupported or ambiguous intervening tables', () => {
    const normalizer = new PdfTableNormalizer();
    normalizer.normalize(header, title, 1, 2);
    normalizer.normalize('unstructured', title, 1, 2);
    expect(
      normalizer.normalize(continuation, next, 2, 1).headerPage,
    ).toBeUndefined();
    normalizer.normalize(header, title, 1, 1);
    const changed =
      '| Meaning | Count | Result |\n| --- | --- | --- |\n| Test | 1 | No |';
    expect(normalizer.normalize(changed, next, 2, 1).issues[0].code).toBe(
      'PDF_TABLE_CONTINUATION_REVIEW',
    );
    expect(
      normalizer.normalize(continuation, next, 3, 1).headerPage,
    ).toBeUndefined();
  });
  it('marks numeric proposed headers for review without inventing a missing standalone header', () => {
    const result = new PdfTableNormalizer().normalize(
      continuation,
      ['Table 3. Different costs'],
      1,
      1,
    );
    expect(result.content).toBe(continuation);
    expect(result.headerPage).toBeUndefined();
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'PDF_TABLE_HEADER_REVIEW',
    ]);
  });
});
