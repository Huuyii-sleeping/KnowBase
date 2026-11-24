const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm, mkdir, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { factCoverage, tableScore, scoreDocument } = require('./metrics.cjs');
const { loadCorpus, digest } = require('./corpus.cjs');
const { generate, workbook } = require('./generate.cjs');

test('facts retain decimal points and signs and do not silently equate wrong values', () => {
  assert.equal(
    factCoverage('9.3摄氏度，退款-2.25元', [['93摄氏度'], ['2.25元']]).matched,
    0,
  );
  assert.equal(factCoverage('93摄氏度', [['9.3摄氏度']]).matched, 0);
  assert.equal(factCoverage('2.25元', [['-2.25元']]).matched, 0);
  assert.equal(
    factCoverage('198万元', [['一百九十八万元', '198万元']]).matched,
    1,
  );
  assert.throws(() => factCoverage('anything', [[' ']]), /nonempty/);
  assert.equal(factCoverage('not $36,000.', [['not $36,000']]).matched, 1);
  assert.equal(factCoverage('not $36,000.5', [['not $36,000']]).matched, 0);
});
test('table scoring rejects moved, duplicated and sign-corrupted cells', () => {
  const gold = [
    {
      rowCount: 2,
      columnCount: 1,
      headerRows: [1],
      cells: [
        [1, 1, '金额'],
        [2, 1, '-2.25'],
      ],
    },
  ];
  const table = {
    rowCount: 2,
    columnCount: 1,
    headerRows: [1],
    cells: [
      { row: 1, column: 1, text: '金额', rowSpan: 1, columnSpan: 1 },
      { row: 2, column: 1, text: '-2.25', rowSpan: 1, columnSpan: 1 },
    ],
  };
  assert.equal(tableScore([table], gold).precision, 1);
  assert.equal(
    tableScore(
      [
        {
          ...table,
          cells: [table.cells[0], { ...table.cells[1], text: '2.25' }],
        },
      ],
      gold,
    ).matchedCells,
    1,
  );
  assert.equal(
    tableScore([{ ...table, cells: [...table.cells, table.cells[1]] }], gold)
      .precision,
    2 / 3,
  );
  assert.equal(tableScore([], gold).recall, 0);
  assert.equal(
    scoreDocument(
      {
        markdown: 'ready',
        blocks: [{ table }],
        quality: { status: 'accepted' },
      },
      { facts: [['ready']], tables: gold },
    ).passed,
    true,
  );
});
test('generated corpus has pinned artifacts and rejects tampering and stale output', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kb-quality-'));
  try {
    const out = path.join(dir, 'corpus');
    await generate(out);
    const corpus = await loadCorpus(out);
    assert.equal(corpus.cases.length, 9);
    assert.equal(corpus.provenance, 'authored-synthetic-business-v1');
    await assert.rejects(generate(out), /already/);
    await writeFile(path.join(out, 'charter.md'), 'changed');
    await assert.rejects(loadCorpus(out), /hash mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('workbook generation is deterministic and annotation-independent', async () => {
  assert.equal(digest(await workbook()), digest(await workbook()));
});
test('corpus loader rejects unsupported kinds, invalid facts, duplicate ids and escaping paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kb-quality-invalid-'));
  try {
    await mkdir(path.join(dir, 'corpus'));
    await writeFile(path.join(dir, 'outside.md'), 'bytes');
    const item = {
      id: 'case',
      kind: 'document',
      split: 'holdout',
      file: '../outside.md',
      sha256: digest(Buffer.from('bytes')),
      facts: [['审核']],
    };
    const manifest = {
      schema: 'ingestion-quality-v1',
      provenance: 'human-annotated-business-v1',
      cases: [item],
    };
    const write = () =>
      writeFile(
        path.join(dir, 'corpus', 'manifest.json'),
        JSON.stringify(manifest),
      );
    await write();
    await assert.rejects(loadCorpus(path.join(dir, 'corpus')), /escapes/);
    item.file = 'document.md';
    await writeFile(path.join(dir, 'corpus', 'document.md'), 'bytes');
    item.kind = 'audio';
    await write();
    await assert.rejects(loadCorpus(path.join(dir, 'corpus')), /identity/);
    item.kind = 'document';
    item.facts = [[' ']];
    await write();
    await assert.rejects(loadCorpus(path.join(dir, 'corpus')), /fact/);
    item.facts = [['审核']];
    manifest.cases.push({ ...item });
    await write();
    await assert.rejects(loadCorpus(path.join(dir, 'corpus')), /identity/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
