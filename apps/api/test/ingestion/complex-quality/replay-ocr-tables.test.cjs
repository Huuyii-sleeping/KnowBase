const { test } = require('node:test');
const assert = require('node:assert/strict');
const { baselineNormalizer, replay } = require('./replay-ocr-tables.cjs');
const {
  PdfTableNormalizer,
} = require('../../../dist/src/modules/documents/parsing/pdf/pdf-table-normalizer.js');
test('replay loads actual baseline and measures missing blank cells independently of title topology', () => {
  const baseline = baselineNormalizer('62c0529');
  const structure = {
    pages: [
      {
        page_idx: 0,
        blocks: [
          {
            type: 'table',
            content:
              '```\n       Title\nName      Value\nA         -1.20\nB         0.00\nC\n```',
          },
        ],
      },
    ],
  };
  const references = [
    {
      page: 1,
      rowCount: 5,
      columnCount: 2,
      headerRows: [1, 2],
      cells: [
        [1, 1, 'Title', 1, 2],
        [2, 1, 'Name'],
        [2, 2, 'Value'],
        [3, 1, 'A'],
        [3, 2, '-1.20'],
        [4, 1, 'B'],
        [4, 2, '0.00'],
        [5, 1, 'C'],
        [5, 2, ''],
      ],
    },
  ];
  assert.equal(
    replay(structure, references, baseline.Normalizer).body[0].matchedCells,
    0,
  );
  const after = replay(structure, references, PdfTableNormalizer);
  assert.equal(after.body[0].matchedCells, 8);
  assert.equal(after.body[0].titleMatched, 1);
  assert.equal(after.full[0].matchedCells, 0);
  assert.deepEqual(after.issues, ['PDF_TABLE_ALIGNED_TEXT_REVIEW']);
});
test('invalid baseline reference fails before replay', () => {
  assert.throws(() => baselineNormalizer('missing-ocr-baseline-ref'));
});
