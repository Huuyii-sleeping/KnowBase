import { describe, expect, it } from 'vitest';
import { parseTable } from '../../ingestion/tables/parse-table';
import { structuredTableFragments } from './table-fragments';

const table =
  '<table><thead><tr><th rowspan="2">部门</th><th colspan="2">预算</th></tr><tr><th>Q1</th><th>Q2</th></tr></thead><tbody>' +
  Array.from(
    { length: 10 },
    (_, i) => `<tr><td>项目${i}</td><td>${i}</td><td>${i + 10}</td></tr>`,
  ).join('') +
  '</tbody></table>';

describe('structured table chunk fragments', () => {
  it('repeats the complete header hierarchy with bounded whole rows and precise table row ranges', () => {
    const chunks = structuredTableFragments(parseTable(table), 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every(
        (chunk) =>
          chunk.text.length <= 100 &&
          chunk.text.includes('预算 / Q1') &&
          chunk.text.includes('预算 / Q2'),
      ),
    ).toBe(true);
    expect(chunks[0].rowStart).toBe(3);
    expect(chunks.at(-1)?.rowEnd).toBe(12);
    for (let i = 0; i < 10; i++)
      expect(
        chunks.some((chunk) =>
          chunk.text.includes(`| 项目${i} | ${i} | ${i + 10} |`),
        ),
      ).toBe(true);
    for (let i = 1; i < chunks.length; i++)
      expect(chunks[i].rowStart).toBe(chunks[i - 1].rowEnd + 1);
  });

  it('refuses an oversized atomic row and still represents a header-only table', () => {
    expect(() =>
      structuredTableFragments(
        parseTable('| A |\n| --- |\n| ' + 'x'.repeat(200) + ' |'),
        100,
      ),
    ).toThrow('header and row');
    expect(() =>
      structuredTableFragments(parseTable('| Long header |\n| --- |'), 3),
    ).toThrow('header');
    expect(structuredTableFragments(parseTable('| A |\n| --- |'), 100)).toEqual(
      [{ text: '| A |\n| --- |', rowStart: 1, rowEnd: 1 }],
    );
  });
});
