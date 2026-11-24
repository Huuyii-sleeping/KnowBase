const { test } = require('node:test');
const assert = require('node:assert/strict');
const { score, rawMarkdown } = require('./score.cjs');
const { summarize, compare } = require('./report.cjs');
const gold = {
  visible: [{ id: 'label', aliases: ['复核结果'] }],
  critical: [{ id: 'refund', aliases: ['退款：-1.25万元'] }],
  unknown: [{ id: 'owner', aliases: ['负责人：未提供'] }],
  sources: [{ id: 'page', page: 2, aliases: ['退款：-1.25万元'] }],
  relations: [{ id: 'edge', from: '复核', to: '隔离', relation: '不合格' }],
  readingOrder: [['先审批', '再付款']],
  contradictions: [{ id: 'wrong-status', aliases: ['状态：已批准'] }],
  tables: [
    {
      id: 'table',
      page: 2,
      rowCount: 2,
      columnCount: 2,
      headerRows: [1],
      cells: [
        [1, 1, '金额', 1, 2],
        [2, 1, '退款'],
        [2, 2, '-1.25'],
      ],
    },
  ],
};
function output() {
  const markdown = '复核结果\n退款：-1.25万元\n负责人：未提供\n先审批\n再付款';
  return {
    markdown,
    ready: false,
    quality: { status: 'needs_review' },
    sections: [{ start: 0, end: markdown.length, source: { page: 2 } }],
    blocks: [
      {
        source: { page: 2 },
        table: {
          rowCount: 2,
          columnCount: 2,
          headerRows: [1],
          cells: [
            { row: 1, column: 1, text: '金额', rowSpan: 1, columnSpan: 2 },
            { row: 2, column: 1, text: '退款', rowSpan: 1, columnSpan: 1 },
            { row: 2, column: 2, text: '-1.25', rowSpan: 1, columnSpan: 1 },
          ],
        },
      },
    ],
    evidence: [
      {
        text: '复核 → 隔离：不合格',
        data: {
          representation: 'visual_description',
          review: 'needs_review',
          facts: [],
          uncertain: [],
          description: '示意图',
          relations: [{ from: '复核', to: '隔离', relation: '不合格' }],
        },
      },
    ],
  };
}
test('literal checks, exact directed relations, merged cells and page sources pass independently', () => {
  const result = score(output(), gold);
  assert.equal(result.automaticChecksPassed, true);
  assert.equal(result.critical.matched, 1);
  assert.equal(result.tables.matchedCells, 3);
  assert.equal(result.manualReview.required, true);
});
test('wrong sign, decimal, unit and missing negation remain factual failures', () => {
  for (const wrong of ['退款：1.25万元', '退款：-125万元', '退款：-1.25元']) {
    const result = output();
    result.markdown = result.markdown.replace('退款：-1.25万元', wrong);
    assert.equal(score(result, gold).critical.matched, 0);
  }
  const value = output();
  value.markdown += '\n状态：已批准';
  assert.deepEqual(score(value, gold).contradictions, ['wrong-status']);
});
test('cooccurring nodes and a reversed arrow cannot satisfy a directed relationship', () => {
  const value = output();
  value.evidence[0].data.relations[0] = {
    from: '隔离',
    to: '复核',
    relation: '不合格',
  };
  const result = score(value, gold);
  assert.equal(result.relations.matched, 0);
  assert.equal(result.manualReview.unverifiedRelations.length, 1);
  value.evidence = [];
  value.markdown += '\n复核 隔离 不合格';
  assert.equal(score(value, gold).relations.matched, 0);
});
test('page mismatch, shifted cells, broken merges and duplicate cells fail', () => {
  let value = output();
  value.sections[0].source.page = 1;
  assert.equal(score(value, gold).sources.matched, 0);
  value = output();
  value.blocks[0].source.page = 1;
  assert.equal(score(value, gold).tables.matchedCells, 0);
  value = output();
  value.blocks[0].table.cells[2].column = 1;
  assert.equal(score(value, gold).tables.matchedCells, 2);
  value = output();
  value.blocks[0].table.cells[0].columnSpan = 1;
  assert.equal(score(value, gold).tables.matchedCells, 2);
  value = output();
  value.blocks[0].table.cells.push(value.blocks[0].table.cells[2]);
  assert.equal(score(value, gold).tables.matched, 0);
});
test('reading order checks full column sequence, including missing tokens', () => {
  const value = output();
  value.markdown = value.markdown.replace('先审批\n再付款', '再付款\n先审批');
  assert.equal(score(value, gold).readingOrder.matched, 0);
  value.markdown = value.markdown.replace('先审批', '');
  assert.equal(score(value, gold).readingOrder.matched, 0);
});
test('unknown remains unknown; unfamiliar generated claims require adjudication', () => {
  const value = output();
  value.markdown = value.markdown.replace('负责人：未提供', '负责人：王五');
  value.evidence[0].data.facts = ['负责人：王五', '退款：-1.25万元'];
  value.ready = true;
  const result = score(value, gold);
  assert.equal(result.unknown.matched, 0);
  assert.equal(result.reviewProtected, false);
  assert.deepEqual(result.manualReview.unverifiedFacts, ['负责人：王五']);
  assert.deepEqual(result.contradictions, []); // Unmatched is not automatically false.
});
test('appended VLM prose never increases OCR or OCR source coverage', () => {
  const value = output();
  value.markdown = '复核结果';
  value.sections = [
    { start: 0, end: value.markdown.length, source: { page: 2 } },
  ];
  const start = value.markdown.length;
  value.evidence[0].text = '退款：-1.25万元';
  value.markdown += '\n\n### 图像机器描述（需核对）\n\n退款：-1.25万元\n';
  value.sections.push({
    start,
    end: value.markdown.length,
    source: { page: 2 },
  });
  const result = score(value, gold);
  assert.equal(result.critical.matched, 0);
  assert.equal(result.visualCritical.matched, 1);
  assert.equal(result.sources.matched, 0);
  assert.equal(rawMarkdown(value).length, value.markdown.length);
});
test('summary separates unavailable/failed inference from completed quality denominators', () => {
  const rows = ['completed', 'failed', 'unavailable'].map((status) => ({
    id: status,
    category: 'chart',
    split: 'holdout',
    status,
    ...(status === 'completed' ? { score: score(output(), gold) } : {}),
  }));
  const summary = summarize(rows)['holdout/chart'];
  assert.equal(summary.attempted, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.metrics.critical.expected, 1);
  assert.equal(summary.unavailable, 1);
  assert.equal(summary.failed, 1);
});
test('comparison rejects changed inputs, annotations, budgets, split and scorer', () => {
  const base = {
    schema: 'complex-quality-run-v1',
    manifestSha256: 'manifest',
    goldSha256: 'gold',
    scorerSha256: 'scorer',
    budgets: { tokens: 10 },
    cases: [
      {
        id: 'one',
        inputSha256: 'input',
        category: 'chart',
        split: 'holdout',
        status: 'completed',
        score: score(output(), gold),
      },
    ],
  };
  assert.equal(compare(base, structuredClone(base))[0].delta.critical, 0);
  for (const key of ['goldSha256', 'scorerSha256', 'budgets']) {
    const invalid = structuredClone(base);
    delete invalid[key];
    assert.throws(() => compare(invalid, structuredClone(invalid)));
  }
  for (const key of ['manifestSha256', 'goldSha256', 'scorerSha256']) {
    const next = structuredClone(base);
    next[key] = 'changed';
    assert.throws(() => compare(base, next));
  }
  for (const key of ['inputSha256', 'category', 'split', 'id']) {
    const next = structuredClone(base);
    next.cases[0][key] = 'changed';
    assert.throws(() => compare(base, next));
  }
  const next = structuredClone(base);
  next.budgets.tokens++;
  assert.throws(() => compare(base, next));
  const unavailable = structuredClone(base);
  unavailable.cases[0].status = 'unavailable';
  assert.equal(compare(base, unavailable)[0].delta, null);
});
