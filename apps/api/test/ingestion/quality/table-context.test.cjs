const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tableContext } = require('./table-context.cjs');
const gold = {
  header: ['阶段', '金额'],
  rows: [
    { row: 2, values: ['预付款', '36'] },
    { row: 3, values: ['试运行', '48'] },
  ],
};
const chunk = {
  content: '| 阶段 | 金额 |\n| --- | --- |\n| 预付款 | 36 |\n| 试运行 | 48 |',
  ranges: [{ source: { tableId: 't1', tableRowStart: 2, tableRowEnd: 3 } }],
};
test('complete row/header association is required, not a bag of values', () => {
  assert.equal(tableContext([chunk], 't1', gold).matched, 2);
  const swapped = {
    ...chunk,
    content: chunk.content
      .replace('预付款 | 36', '预付款 | 48')
      .replace('试运行 | 48', '试运行 | 36'),
  };
  assert.equal(tableContext([swapped], 't1', gold).matched, 0);
  assert.equal(
    tableContext(
      [
        {
          ...chunk,
          content: chunk.content.replace('| 阶段 | 金额 |', '| 金额 | 阶段 |'),
        },
      ],
      't1',
      gold,
    ).matched,
    0,
  );
});
test('source identity and row positions must match even if all text exists elsewhere', () => {
  assert.equal(tableContext([chunk], 'another-table', gold).matched, 0);
  assert.equal(
    tableContext(
      [
        {
          ...chunk,
          ranges: [
            { source: { tableId: 't1', tableRowStart: 3, tableRowEnd: 3 } },
          ],
        },
      ],
      't1',
      gold,
    ).matched,
    1,
  );
  assert.equal(
    tableContext(
      [
        { ...chunk, content: '| 阶段 | 金额 |' },
        { ...chunk, content: '| 预付款 | 36 |' },
      ],
      't1',
      gold,
    ).matched,
    0,
  );
});
