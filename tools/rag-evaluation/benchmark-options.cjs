const path = require('node:path');
const { parseRouteBudgets } = require('./recall-budget.cjs');
const root = path.resolve(__dirname, '../..');

function options(args) {
  const result = {
    python: process.env.KNOWBASE_EVAL_PYTHON || 'python3',
    output: path.join(root, 'reports/retrieval-knowbase-v1'),
    dataset: path.join(root, 'benchmarks/knowbase-retrieval-v1'),
    suite: 'baseline',
    encoding: 'plain',
    lexical: 'standard',
    context: 'body',
    keywordPolicy: 'combined',
    bodySlots: 2,
    queryMode: 'off',
    split: 'all',
    budgets: [5, 10, 15, 30, 60],
  };
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        '--python',
        '--output-dir',
        '--dataset',
        '--suite',
        '--encoding',
        '--lexical',
        '--context',
        '--keyword-policy',
        '--body-slots',
        '--query-mode',
        '--split',
        '--budgets',
        '--route-budgets',
      ].includes(args[i]) ||
      !args[i + 1]
    )
      throw new Error(
        'Usage: run_baseline.cjs [--python executable] [--output-dir directory] [--dataset directory] [--suite baseline|recall] [--encoding plain|nomic-task] [--lexical standard|cjk] [--context body|title|title-heading] [--keyword-policy combined|weighted|body-reserve] [--body-slots 1|2|3] [--query-mode off|clauses-keyword|clauses-both] [--split all|development|validation|regression] [--budgets 5,10,15,30,60 | --route-budgets 15:5,10:10,5:15]',
      );
    if (args[i] === '--python') result.python = args[i + 1];
    else if (args[i] === '--output-dir')
      result.output = path.resolve(root, args[i + 1]);
    else if (args[i] === '--dataset')
      result.dataset = path.resolve(root, args[i + 1]);
    else if (args[i] === '--suite') result.suite = args[i + 1];
    else if (args[i] === '--lexical') result.lexical = args[i + 1];
    else if (args[i] === '--context') result.context = args[i + 1];
    else if (args[i] === '--keyword-policy') result.keywordPolicy = args[i + 1];
    else if (args[i] === '--body-slots') result.bodySlots = Number(args[i + 1]);
    else if (args[i] === '--query-mode') result.queryMode = args[i + 1];
    else if (args[i] === '--split') result.split = args[i + 1];
    else if (args[i] === '--route-budgets')
      result.routeBudgets = parseRouteBudgets(args[i + 1]);
    else if (args[i] === '--budgets')
      result.budgets = args[i + 1].split(',').map(Number);
    else result.encoding = args[i + 1];
  }
  if (
    !['baseline', 'recall'].includes(result.suite) ||
    !['plain', 'nomic-task'].includes(result.encoding) ||
    !['standard', 'cjk'].includes(result.lexical) ||
    !['body', 'title', 'title-heading'].includes(result.context) ||
    !['combined', 'weighted', 'body-reserve'].includes(result.keywordPolicy) ||
    ![1, 2, 3].includes(result.bodySlots) ||
    !['off', 'clauses-keyword', 'clauses-both'].includes(result.queryMode)
  )
    throw new Error('Invalid evaluation suite or encoding');
  if (result.queryMode !== 'off' && result.suite !== 'recall')
    throw new Error('Multi-intent query modes require recall suite');
  if (
    !['all', 'development', 'validation', 'regression'].includes(
      result.split,
    ) ||
    !result.budgets.length ||
    new Set(result.budgets).size !== result.budgets.length ||
    result.budgets.some(
      (value) => !Number.isInteger(value) || value < 1 || value > 100,
    )
  )
    throw new Error('Invalid recall split or budgets');
  if (
    result.routeBudgets &&
    (args.includes('--budgets') || result.suite !== 'recall')
  )
    throw new Error(
      'Route budgets require recall suite and cannot combine with --budgets',
    );
  return result;
}

module.exports = { options };
