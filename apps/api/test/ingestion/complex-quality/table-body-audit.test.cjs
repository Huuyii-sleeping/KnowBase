const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tableBodyAudit } = require('./table-body-audit.cjs');
const reference = {
  page: 2,
  rowCount: 3,
  columnCount: 2,
  headerRows: [2],
  cells: [
    [1, 1, 'Calibration', 1, 2],
    [2, 1, 'Probe'],
    [2, 2, 'mm'],
    [3, 1, 'A'],
    [3, 2, ''],
  ],
};
const result = () => ({
  blocks: [
    {
      source: { page: 2 },
      table: {
        caption: 'Calibration',
        rowCount: 2,
        columnCount: 2,
        headerRows: [1],
        cells: [
          { row: 1, column: 1, text: 'Probe', rowSpan: 1, columnSpan: 1 },
          { row: 1, column: 2, text: 'mm', rowSpan: 1, columnSpan: 1 },
          { row: 2, column: 1, text: 'A', rowSpan: 1, columnSpan: 1 },
          { row: 2, column: 2, text: '', rowSpan: 1, columnSpan: 1 },
        ],
      },
    },
  ],
});
test('body metric preserves exact empty coordinates and never claims a merged title is recovered', () => {
  const audit = tableBodyAudit(result(), [reference])[0];
  assert.equal(audit.matchedCells, 4);
  assert.equal(audit.titleMatched, 1);
  assert.equal(audit.mergedTitleTopology, 'not_verified');
  assert.equal(tableBodyAudit({}, [reference])[0].matchedCells, 0);
});
test('wrong source, column shift, missing empty cell and zero substitution fail the body metric', () => {
  for (const mutate of [
    (x) => {
      x.blocks[0].source.page = 1;
    },
    (x) => {
      x.blocks[0].table.cells[2].column = 2;
    },
    (x) => {
      x.blocks[0].table.cells.pop();
    },
    (x) => {
      x.blocks[0].table.cells[3].text = '0';
    },
  ]) {
    const x = result();
    mutate(x);
    assert.ok(tableBodyAudit(x, [reference])[0].matchedCells < 4);
  }
});
test('body metric refuses to hide ambiguous leading rows or multiple header rows', () => {
  assert.equal(
    tableBodyAudit(result(), [{ ...reference, headerRows: [1, 2] }])[0]
      .matchedCells,
    4,
  );
  assert.throws(() =>
    tableBodyAudit(result(), [{ ...reference, headerRows: [1, 3] }]),
  );
  assert.throws(() =>
    tableBodyAudit(result(), [
      {
        ...reference,
        cells: [[1, 1, 'Unmerged'], ...reference.cells.slice(1)],
      },
    ]),
  );
});
