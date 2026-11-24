import { describe, expect, it } from 'vitest';
import { parseTable } from './parse-table';
import { tableSearchView } from './table-view';

export const mergedBudgetTable =
  '<table><thead><tr><th rowspan="2">部门</th><th colspan="2">预算（万元）</th></tr><tr><th>一季度</th><th>二季度</th></tr></thead><tbody><tr><td rowspan="2">研发</td><td>100</td><td>120</td></tr><tr><td>50</td><td>-5</td></tr><tr><td>运营</td><td>30</td><td>40</td></tr></tbody></table>';

describe('canonical table extraction', () => {
  it('preserves merged cells and derives contextual headers without duplicating canonical values', () => {
    const table = parseTable(mergedBudgetTable, 'source-1');
    expect(table).toMatchObject({
      schema: 'table-v1',
      format: 'html',
      rowCount: 5,
      columnCount: 3,
      headerRows: [1, 2],
    });
    expect(table.cells).toHaveLength(12);
    expect(table.cells.filter((cell) => cell.text === '研发')).toEqual([
      expect.objectContaining({ row: 3, column: 1, rowSpan: 2, columnSpan: 1 }),
    ]);
    const view = tableSearchView(table);
    expect(view.header).toContain('预算（万元） / 一季度');
    expect(view.header).toContain('预算（万元） / 二季度');
    expect(view.rows).toEqual([
      { row: 3, text: '| 研发 | 100 | 120 |' },
      { row: 4, text: '| 研发 | 50 | -5 |' },
      { row: 5, text: '| 运营 | 30 | 40 |' },
    ]);
    expect(parseTable(mergedBudgetTable, 'source-1')).toEqual(table);
    expect(parseTable(mergedBudgetTable, 'source-2').id).not.toBe(table.id);
  });

  it('decodes HTML entities, preserves visible text and excludes executable content', () => {
    const table = parseTable(
      '<table><caption>预算 &amp; 费用</caption><tr><td>A<br>B<script>secret()</script></td><td>&lt;5<img alt="图示" src="https://example.com"></td></tr></table>',
    );
    expect(table.caption).toBe('预算 & 费用');
    expect(table.cells.map((cell) => cell.text)).toEqual(['A\nB', '<5图示']);
    expect(tableSearchView(table).header).toContain('列 1');
    expect(tableSearchView(table).header).toContain('预算 & 费用');
    expect(tableSearchView(table).rows).toHaveLength(1);
  });

  it('keeps row headers out of the column-header row set and does not guess units or types', () => {
    const table = parseTable(
      '<table><tr><th scope="ROW">余额</th><td>001.20 万元</td></tr></table>',
    );
    expect(table.headerRows).toEqual([]);
    expect(table.cells[0].scope).toBe('row');
    expect(table.cells[1].text).toBe('001.20 万元');
    expect(tableSearchView(table).rows[0].text).toContain('余额');
  });

  it('handles Markdown escaped pipes, blank values, negative signs and zero without dropping rows', () => {
    const table = parseTable(
      '| 名称 | 金额 |\n| --- | ---: |\n| A\\|B | 0 |\n| 空 | |\n| 负数 | -5.30 |',
    );
    expect(
      table.cells.filter((cell) => !cell.header).map((cell) => cell.text),
    ).toEqual(['A|B', '0', '空', '', '负数', '-5.30']);
    expect(tableSearchView(table).rows[0].text).toBe('| A\\|B | 0 |');
  });

  it('round trips backslashes and literal pipes in the derived Markdown view', () => {
    const table = parseTable(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>C:\\data\\</td><td>x\\|y</td></tr></table>',
    );
    const view = tableSearchView(table);
    const reparsed = parseTable(
      [view.header, ...view.rows.map((row) => row.text)].join('\n'),
    );
    expect(reparsed.cells.map((cell) => cell.text)).toEqual(
      table.cells.map((cell) => cell.text),
    );
  });

  it('accepts a final newline without inventing an empty table row', () => {
    expect(parseTable('| A |\n| --- |\n| 0 |\n').rowCount).toBe(2);
  });

  it.each([
    '<table></table>',
    '<table><tr><td colspan="257">A</td></tr></table>',
    '<table><tr><td rowspan="2">A</td></tr></table>',
    '<table><thead><tr><th rowspan="2">A</th></tr></thead><tbody><tr></tr></tbody></table>',
    '<table>lost text<tr><td>A</td></tr></table>',
    '<table><tr>lost text<td>A</td></tr></table>',
    '<table><tr><td>A</td><td rowspan="2">B</td></tr><tr><td colspan="2">C</td></tr></table>',
    '<table><tr><td><table><tr><td>nested</td></tr></table></td></tr></table>',
    '| A | B |\n| --- | --- |\n| one |',
  ])(
    'rejects malformed/unsupported structure instead of silently losing cells: %s',
    (source) => {
      expect(() => parseTable(source)).toThrow();
    },
  );

  it('enforces occupied-slot and source budgets before unbounded grid allocation', () => {
    const huge =
      '<table><tr><td rowspan="1000" colspan="256">x</td></tr>' +
      '<tr></tr>'.repeat(999) +
      '</table>';
    expect(() => parseTable(huge)).toThrow('budget');
    const sparse =
      '<table><tr><td colspan="256">x</td></tr>' +
      '<tr><td>x</td></tr>'.repeat(999) +
      '</table>';
    expect(() => parseTable(sparse)).toThrow('grid budget');
    expect(() => parseTable('x'.repeat(4194305))).toThrow('budget');
  });

  it('resolves zero row spans only within their own group and retains canonical anchors', () => {
    const table = parseTable(
      '<table><tbody><tr><td rowspan="0">杭州</td><td>A</td></tr><tr><td>B</td></tr></tbody><tbody><tr><td rowspan="0">苏州</td><td>C</td></tr><tr><td>D</td></tr></tbody></table>',
    );
    expect(table.cells.filter((cell) => cell.column === 1)).toEqual([
      expect.objectContaining({ row: 1, text: '杭州', rowSpan: 2 }),
      expect.objectContaining({ row: 3, text: '苏州', rowSpan: 2 }),
    ]);
    expect(tableSearchView(table).rows.map((row) => row.text)).toEqual([
      '| 杭州 | A |',
      '| 杭州 | B |',
      '| 苏州 | C |',
      '| 苏州 | D |',
    ]);
    expect(
      parseTable('<table><tr><td rowspan="0">A</td></tr></table>').cells[0]
        .rowSpan,
    ).toBe(1);
    expect(() =>
      parseTable(
        '<table><tr><td rowspan="0" colspan="256">x</td></tr>' +
          '<tr></tr>'.repeat(999) +
          '</table>',
      ),
    ).toThrow('budget');
    expect(() =>
      parseTable('<table><tr><td colspan="0">x</td></tr></table>'),
    ).toThrow('span');
  });
});
