const test = require('node:test');
const assert = require('node:assert/strict');
const { keywordQuery } = require('./keyword-query.cjs');
const { options } = require('./benchmark-options.cjs');

test('keyword reduction removes only frozen question words and never joins CJK neighbors', () => {
  assert.equal(
    keywordQuery('请问为什么上传失败？', 'trim-question'),
    '上传失败？',
  );
  assert.equal(
    keywordQuery('由什么角色批准吗？', 'trim-question'),
    '由 角色批准 ？',
  );
  const query =
    '未满24小时是否能撤回，审批完成后由谁确认，N-123_v2不能删除吗？';
  assert.equal(
    keywordQuery(query, 'trim-question'),
    '未满24小时是否能撤回，审批完成后由谁确认，N-123_v2不能删除 ？',
  );
  assert.equal(
    keywordQuery('超过多少天不允许撤回？', 'trim-question'),
    '超过多少天不允许撤回？',
  );
  assert.equal(keywordQuery('  请问怎么处理？  '), '  请问怎么处理？  ');
});

test('ambiguous, protected or empty reductions fall back; invalid input and modes fail', () => {
  for (const query of [
    '“为什么”这个标题如何检索？',
    '“什么未闭合，如何检索？',
    '代码`怎么()`是什么？',
    '不满足条件（未满24小时）怎么处理？',
    '什么？',
    '请问什么吗？',
    'X'.repeat(513) + '怎么处理？',
  ])
    assert.equal(keywordQuery(query, 'trim-question'), query);
  for (const query of ['', ' ', null, 42])
    assert.throws(() => keywordQuery(query, 'trim-question'), /non-empty/);
  assert.throws(() => keywordQuery('query', 'bad'), /Invalid/);
  assert.throws(() => options(['--keyword-query-mode', 'bad']), /Invalid/);
  assert.throws(
    () => options(['--keyword-query-mode', 'trim-question']),
    /require recall/,
  );
  assert.throws(
    () =>
      options([
        '--suite',
        'recall',
        '--keyword-query-mode',
        'trim-question',
        '--query-mode',
        'clauses-both',
      ]),
    /combined/,
  );
  assert.equal(
    options(['--suite', 'recall', '--keyword-query-mode', 'trim-question'])
      .keywordQueryMode,
    'trim-question',
  );
});
