const path = require('node:path');
const { readFile, writeFile } = require('node:fs/promises');
const { compare } = require('./report.cjs');
async function compareFiles(before, after, output) {
  const result = compare(
    JSON.parse(await readFile(before, 'utf8')),
    JSON.parse(await readFile(after, 'utf8')),
  );
  await writeFile(
    output,
    JSON.stringify(
      { schema: 'complex-quality-comparison-v1', cases: result },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  return result;
}
if (require.main === module) {
  if (process.argv.length !== 5)
    throw new Error('Usage: compare.cjs BEFORE_RUN AFTER_RUN NEW_OUTPUT_FILE');
  compareFiles(...process.argv.slice(2).map((x) => path.resolve(x)))
    .then(console.table)
    .catch(() => {
      console.error(
        'Comparison rejected; check pinned corpus, scorer, budgets and a fresh output file.',
      );
      process.exitCode = 1;
    });
}
module.exports = { compareFiles };
