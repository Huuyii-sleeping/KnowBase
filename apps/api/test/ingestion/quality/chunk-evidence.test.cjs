const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../runtime.cjs');
const { scoreChunks, covers } = require('./chunk-evidence.cjs');
const { markdownBlocks } = load('ingestion/markdown-blocks.js');
const tables = load('ingestion/tables/table-view.js');
const { MarkdownChunkerService } = load(
  'pipeline/chunk/markdown-chunker.service.js',
);
const { ConfigService } = require('@nestjs/config');
const split = (markdown, size = 180) =>
  new MarkdownChunkerService(
    new ConfigService({ RAG_CHUNK_SIZE: size, RAG_CHUNK_OVERLAP: 0 }),
  ).splitStructured(markdown);
const clone = (x) => JSON.parse(JSON.stringify(x));
test('evidence requires quotes together in their own section and rejects copied text with wrong provenance', async () => {
  const markdown =
    '# 责任\n\n## 恢复\n\n响应15分钟，恢复120分钟。\n\n## 禁止\n\n不得出库。';
  const blocks = markdownBlocks(markdown),
    chunks = await split(markdown);
  const units = [
    { id: 'response', heading: '恢复', quotes: ['响应15分钟', '恢复120分钟'] },
  ];
  const score = (value) => scoreChunks(markdown, blocks, value, units, tables);
  assert.equal(score(chunks).passed, true);
  const separated = clone(chunks);
  separated[0].content = '响应15分钟';
  separated.push({ ...clone(separated[0]), content: '恢复120分钟' });
  assert.equal(score(separated).preservedQuotes, 2);
  assert.equal(score(separated).sourceMatched, 1);
  assert.equal(score(separated).together, 0);
  const wrong = clone(chunks);
  wrong[0].headingPath = ['禁止'];
  assert.equal(score(wrong).sourceMatched, 0);
  const noRange = clone(chunks);
  noRange[0].ranges = [];
  assert.equal(score(noRange).passed, false);
  const wrongBlock = clone(chunks);
  wrongBlock[0].ranges = [clone(chunks[1].ranges[0])];
  assert.equal(score(wrongBlock).passed, false);
  assert.throws(
    () =>
      scoreChunks(
        markdown,
        blocks,
        chunks,
        [{ ...units[0], quotes: ['未出现'] }],
        tables,
      ),
    /Missing annotated/,
  );
});
test('wide-cell metrics reject missing ranges, wrong columns, altered text, wrong table and broken coverage', async () => {
  const markdown =
    '# 质量\n\n## 审查\n\n| 采购单 | 条款 |\n| --- | --- |\n| B72 | ' +
    '登记审批；'.repeat(90) +
    '最终批准后才付款。 |';
  const blocks = markdownBlocks(markdown),
    chunks = await split(markdown);
  const units = [
    {
      id: 'payment',
      heading: '审查',
      table: 0,
      row: 2,
      column: 2,
      quotes: ['最终批准后才付款'],
    },
  ];
  const score = (value) => scoreChunks(markdown, blocks, value, units, tables);
  assert.equal(score(chunks).passed, true);
  const final = chunks.findIndex((c) => c.content.includes('最终批准后才付款'));
  for (const mutation of [
    (c) => {
      c[final].ranges[0].source.tableColumn = 1;
    },
    (c) => {
      c[final].ranges[0].source.tableId = 'wrong';
    },
    (c) => {
      c[final].ranges[0].source.tableRowStart = 99;
    },
    (c) => {
      c[final].content = c[final].content.replace(
        '最终批准后才付款',
        '任何人都可付款',
      );
    },
    (c) => {
      c.splice(final, 1);
    },
    (c) => {
      c[final].ranges[0].source.tableCellStart += 1;
    },
  ]) {
    const changed = clone(chunks);
    mutation(changed);
    assert.equal(score(changed).passed, false);
  }
  assert.equal(
    covers(
      [
        { start: 0, end: 3 },
        { start: 4, end: 9 },
      ],
      9,
    ),
    false,
  );
  assert.equal(
    covers(
      [
        { start: 0, end: 3 },
        { start: 3, end: 9 },
      ],
      9,
    ),
    true,
  );
  assert.equal(covers([], 0), false);
  const duplicates = [...chunks, chunks[0]];
  assert.equal(
    score(duplicates).identicalChunkCharacters -
      score(chunks).identicalChunkCharacters,
    chunks[0].content.length,
  );
});
test('ordinary table metrics require full row/header association rather than detached values', async () => {
  const markdown =
    '## 付款\n\n| 阶段 | 金额 | 条件 |\n| --- | --- | --- |\n| 最终验收 | 36 | 缺陷关闭 |';
  const blocks = markdownBlocks(markdown),
    chunks = await split(markdown, 512);
  const units = [
    {
      id: 'condition',
      heading: '付款',
      table: 0,
      row: 2,
      column: 3,
      quotes: ['缺陷关闭'],
    },
  ];
  assert.equal(
    scoreChunks(markdown, blocks, chunks, units, tables).passed,
    true,
  );
  for (const patch of [
    { table: 99 },
    { table: -1 },
    { row: 1 },
    { row: 99 },
    { column: 0 },
    { column: 4 },
  ])
    assert.throws(
      () =>
        scoreChunks(
          markdown,
          blocks,
          chunks,
          [{ ...units[0], ...patch }],
          tables,
        ),
      /Invalid annotated/,
    );
  chunks[0].content = chunks[0].content.replace(
    '| 阶段 | 金额 | 条件 |',
    '| 阶段 | 条件 | 金额 |',
  );
  assert.equal(
    scoreChunks(markdown, blocks, chunks, units, tables).passed,
    false,
  );
});
