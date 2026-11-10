const path = require('node:path');
const root = path.resolve(__dirname, '../..');

function options(args) {
  const result = {
    python: process.env.KNOWBASE_EVAL_PYTHON || 'python3',
    output: path.join(root, 'reports/retrieval-knowbase-v1'),
    dataset: path.join(root, 'benchmarks/knowbase-retrieval-v1'),
    suite: 'baseline',
    encoding: 'plain',
    lexical: 'standard',
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
        '--split',
        '--budgets',
      ].includes(args[i]) ||
      !args[i + 1]
    )
      throw new Error(
        'Usage: run_baseline.cjs [--python executable] [--output-dir directory] [--dataset directory] [--suite baseline|recall] [--encoding plain|nomic-task] [--lexical standard|cjk] [--split all|development|validation] [--budgets 5,10,15,30,60]',
      );
    if (args[i] === '--python') result.python = args[i + 1];
    else if (args[i] === '--output-dir')
      result.output = path.resolve(root, args[i + 1]);
    else if (args[i] === '--dataset')
      result.dataset = path.resolve(root, args[i + 1]);
    else if (args[i] === '--suite') result.suite = args[i + 1];
    else if (args[i] === '--lexical') result.lexical = args[i + 1];
    else if (args[i] === '--split') result.split = args[i + 1];
    else if (args[i] === '--budgets')
      result.budgets = args[i + 1].split(',').map(Number);
    else result.encoding = args[i + 1];
  }
  if (
    !['baseline', 'recall'].includes(result.suite) ||
    !['plain', 'nomic-task'].includes(result.encoding) ||
    !['standard', 'cjk'].includes(result.lexical)
  )
    throw new Error('Invalid evaluation suite or encoding');
  if (
    !['all', 'development', 'validation'].includes(result.split) ||
    !result.budgets.length ||
    new Set(result.budgets).size !== result.budgets.length ||
    result.budgets.some(
      (value) => !Number.isInteger(value) || value < 1 || value > 100,
    )
  )
    throw new Error('Invalid recall split or budgets');
  return result;
}

module.exports = { options };
