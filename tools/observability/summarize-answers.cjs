const fs = require('node:fs');
const readline = require('node:readline');
const { parseLogLine, AnswerMetrics } = require('./answer-metrics.cjs');

async function main(paths = process.argv.slice(2)) {
  if (
    paths.some((p) => p.startsWith('-') && p !== '-') ||
    paths.filter((p) => p === '-').length > 1
  )
    throw new Error(
      'Usage: node tools/observability/summarize-answers.cjs [log-file ... | -]',
    );
  const metrics = new AnswerMetrics();
  for (const file of paths.length ? paths : ['-']) {
    const input =
      file === '-'
        ? process.stdin
        : fs.createReadStream(file, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) metrics.add(parseLogLine(line));
    } finally {
      lines.close();
      if (file !== '-') input.destroy();
    }
  }
  process.stdout.write(JSON.stringify(metrics.result(), null, 2) + '\n');
}
if (require.main === module)
  main().catch(() => {
    process.stderr.write(
      'Answer summary failed: check log paths and command arguments.\n',
    );
    process.exitCode = 1;
  });
module.exports = { main };
