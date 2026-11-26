const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertTablesPreserved,
  tableChunkDelivery,
} = require('./table-delivery.cjs');
const table = {
  id: 't',
  caption: '测量',
  rowCount: 2,
  columnCount: 2,
  headerRows: [1],
  cells: [
    { row: 1, column: 1, rowSpan: 1, columnSpan: 1, text: '设备' },
    { row: 1, column: 2, rowSpan: 1, columnSpan: 1, text: 'mm' },
    { row: 2, column: 1, rowSpan: 1, columnSpan: 1, text: '探头' },
    { row: 2, column: 2, rowSpan: 1, columnSpan: 1, text: '' },
  ],
};
const markdown =
  '<table><caption>测量</caption><tr><th>设备</th><th>mm</th></tr><tr><td>探头</td><td></td></tr></table>';
const {
  markdownBlocks,
} = require('../../../dist/src/modules/ingestion/markdown-blocks.js');
const sections = [{ start: 0, end: markdown.length, source: { page: 2 } }];
const block = markdownBlocks(markdown, sections)[0];
const persisted = {
  ...block.table,
  start: 0,
  end: markdown.length,
  source: { page: 2 },
};
const stored = { tables: [persisted] };
test('stored tables must preserve blank cells, caption and source, not only old scalar scores', () => {
  assert.doesNotThrow(() =>
    assertTablesPreserved({ markdown, sections }, stored),
  );
  for (const mutate of [
    (x) => {
      x.tables[0].caption = 'other';
    },
    (x) => {
      x.tables[0].cells[3].text = '0';
    },
    (x) => {
      x.tables[0].source.page = 1;
    },
  ]) {
    const x = structuredClone(stored);
    mutate(x);
    assert.throws(() => assertTablesPreserved({ markdown, sections }, x));
  }
});
test('table row delivery needs complete header, exact blank row and correct logical source', () => {
  const chunk = {
    content: '测量\n\n| 设备 | mm |\n| --- | --- |\n| 探头 |  |',
    ranges: [
      {
        source: {
          page: 2,
          tableId: block.table.id,
          tableRowStart: 2,
          tableRowEnd: 2,
        },
      },
    ],
  };
  assert.equal(tableChunkDelivery(stored, [chunk])[0].matchedRows, 1);
  for (const mutate of [
    (x) => {
      x.content = x.content.replace('| 探头 |  |', '| 探头 | 0 |');
    },
    (x) => {
      x.ranges[0].source.page = 1;
    },
    (x) => {
      x.content = x.content.replace('mm', '');
    },
  ]) {
    const x = structuredClone(chunk);
    mutate(x);
    assert.equal(tableChunkDelivery(stored, [x])[0].matchedRows, 0);
  }
});
