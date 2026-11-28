import { describe, expect, it } from 'vitest';
import { parseTable } from './parse-table';
import { sumTableCells } from './table-sum';

describe('evidenced table decimal sum', () => {
  it('adds exact decimals, signs, separators and zero with original cell references', () => {
    const table = parseTable(
      '| 费用 |\n| --- |\n| 0.1 |\n| 0.20 |\n| -5 |\n| 1,000.30 |\n| 0 |',
    );
    expect(
      sumTableCells(
        table,
        [2, 3, 4, 5, 6].map((row) => ({ row, column: 1 })),
      ),
    ).toEqual({
      tableId: table.id,
      operation: 'sum',
      value: '995.60',
      cells: [2, 3, 4, 5, 6].map((row) => ({ row, column: 1 })),
    });
    expect(
      sumTableCells(table, [
        { row: 2, column: 1 },
        { row: 3, column: 1 },
      ]).value,
    ).toBe('0.30');
  });

  it('rejects duplicate/covered merge cells, invalid coordinates and headers', () => {
    const table = parseTable(
      '<table><tr><th>金额</th></tr><tr><td rowspan="2">12</td></tr><tr></tr></table>',
    );
    expect(sumTableCells(table, [{ row: 2, column: 1 }]).value).toBe('12');
    for (const references of [
      [],
      [{ row: 3, column: 1 }],
      [{ row: 1, column: 1 }],
      [{ row: 0.5, column: 1 }],
      [
        { row: 2, column: 1 },
        { row: 2, column: 1 },
      ],
    ])
      expect(() => sumTableCells(table, references)).toThrow();
  });

  it.each([
    '',
    '10 万元',
    '5%',
    '=1+1',
    '1,23',
    'NaN',
    '1e5',
    '0.1234567890123456789',
  ])('does not guess numeric meaning: %s', (value) => {
    const table = parseTable(`| 金额 |\n| --- |\n| ${value} |`);
    expect(() => sumTableCells(table, [{ row: 2, column: 1 }])).toThrow();
  });
});
