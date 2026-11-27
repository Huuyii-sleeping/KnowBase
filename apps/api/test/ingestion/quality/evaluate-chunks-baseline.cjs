const { baselineReference } = require('../baseline-reference.cjs');
// Test process only: load the two splitter modules from an explicit Git revision.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { writeFile } = require('node:fs/promises');
const Module = require('node:module');
const ts = require('typescript');
const { digest } = require('./corpus.cjs');
(async () => {
  const reference = baselineReference(process.argv[2]);
  if (!/^[a-f0-9]{40}$/.test(reference || ''))
    throw new Error('An explicit full Git commit is required');
  const root = path.resolve(__dirname, '../../../../..');
  const snapshots = [];
  for (const name of ['table-fragments', 'structured-chunks']) {
    const sourcePath = `apps/api/src/modules/pipeline/chunk/${name}.ts`;
    const source = execFileSync('git', ['show', `${reference}:${sourcePath}`], {
      cwd: root,
      encoding: 'utf8',
    });
    const filename = path.resolve(
      __dirname,
      `../../../dist/src/modules/pipeline/chunk/${name}.js`,
    );
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
      },
    });
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    loaded._compile(compiled.outputText, filename);
    require.cache[filename] = loaded;
    snapshots.push({ sourcePath, sha256: digest(source) });
  }
  const { evaluate } = require('./evaluate-chunks.cjs');
  const destination = path.resolve(process.argv[4]);
  const report = await evaluate(path.resolve(process.argv[3]), destination);
  report.baseline = {
    reference,
    snapshots,
    scope:
      'Only table-fragments and structured-chunks are restored in this isolated evaluation process; all inputs, parser/block reader and scoring remain identical.',
  };
  await writeFile(
    path.join(destination, 'chunks.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    `${report.cases.filter((row) => row.passed).length}/${report.cases.length} baseline configurations passed`,
  );
  // Baseline quality failures are expected; execution errors still produce a nonzero exit.
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
