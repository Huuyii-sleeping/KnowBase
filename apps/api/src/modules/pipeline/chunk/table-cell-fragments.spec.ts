import { describe, expect, it } from 'vitest';
import { parseTable } from '../../ingestion/tables/parse-table';
import { tableGrid, tableSearchView } from '../../ingestion/tables/table-view';
import { structuredTableFragments } from './table-fragments';

describe('bounded cell fallback for wide tables', () => {
  it('preserves every visible cell, blanks, signs and merged header/row context without changing canonical evidence', () => {
    const table = parseTable(
      '<table><caption>季度核对</caption><tr><th rowspan="2">部门</th><th colspan="2">预算</th><th rowspan="2">备注</th></tr><tr><th>Q1</th><th>Q2</th></tr><tr><td rowspan="2">研发</td><td>0</td><td>-2.25</td><td>' +
        '待核对😀；'.repeat(30) +
        '</td></tr><tr><td></td><td>120</td><td>A|B\\C</td></tr></table>',
    );
    const snapshot = JSON.stringify(table);
    const grid = tableGrid(table);
    const view = tableSearchView(table);
    const chunks = structuredTableFragments(table, 100);
    for (const row of view.rows)
      for (let column = 1; column <= table.columnCount; column++) {
        const parts = chunks.filter(
          (chunk) => chunk.rowStart === row.row && chunk.column === column,
        );
        const original = grid[row.row - 1][column - 1]?.text || '';
        expect(parts.length).toBeGreaterThan(0);
        let cursor = 0;
        for (const part of parts) {
          expect(part.cellStart).toBe(cursor);
          expect(part.text).toContain(view.headers[column - 1]);
          expect(
            part.text.endsWith(original.slice(part.cellStart, part.cellEnd)),
          ).toBe(true);
          expect(part.text.length).toBeLessThanOrEqual(100);
          expect(part.text).not.toMatch(/[\uD800-\uDBFF]$/u);
          if (column > 1) expect(part.text).toContain('行标识：研发');
          cursor = part.cellEnd!;
        }
        expect(cursor).toBe(original.length);
      }
    expect(JSON.stringify(table)).toBe(snapshot);
    expect(structuredTableFragments(table, 100)).toEqual(chunks);
  });
  it('preserves long row labels as their own fragments and never invents an abbreviated identifier', () => {
    const text = '长标识😀'.repeat(30);
    const table = parseTable(
      '| 编号 | 状态 |\n| --- | --- |\n| ' + text + ' | 未批准 |',
    );
    const chunks = structuredTableFragments(table, 80);
    const status = chunks.find((chunk) => chunk.column === 2)!;
    expect(status.text).toContain('表内行 2，列 2');
    expect(status.text).toContain('未批准');
    expect(status.text).not.toContain('行标识');
    expect(chunks.filter((chunk) => chunk.column === 1).at(-1)?.cellEnd).toBe(
      text.length,
    );
  });
  it('fails explicitly when a column header or caption leaves no value budget', () => {
    expect(() =>
      structuredTableFragments(
        parseTable('| ' + '标题'.repeat(100) + ' |\n| --- |\n| 0 |'),
        80,
      ),
    ).toThrow('context');
    expect(() =>
      structuredTableFragments(
        parseTable(
          '<table><caption>' +
            '说明'.repeat(100) +
            '</caption><tr><td>0</td></tr></table>',
        ),
        80,
      ),
    ).toThrow('context');
  });
  it.each([0, -1, NaN, Infinity, 12.5])(
    'rejects an invalid standalone budget: %s',
    (budget) => {
      expect(() =>
        structuredTableFragments(parseTable('| A |\n| --- |\n| 0 |'), budget),
      ).toThrow('budget');
    },
  );
});
