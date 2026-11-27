const { baselineReference } = require('./baseline-reference.cjs');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { ConfigService } = require('@nestjs/config');

// Load the actual pre-change chunker and its local dependencies, without checking
// out files in the user's worktree or constructing unrelated infrastructure.
function snapshotChunker(ref, options) {
  const repository = path.resolve(__dirname, '../../../..');
  const git = (...args) =>
    execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
    }).trim();
  const revision = git(
    'rev-parse',
    '--verify',
    `${baselineReference(ref)}^{commit}`,
  );
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'knowbase-table-baseline-'),
  );
  const dispose = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    fs.symlinkSync(
      path.resolve(__dirname, '../../node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    const files = git(
      'ls-tree',
      '-r',
      '--name-only',
      revision,
      'apps/api/src/modules/ingestion',
      'apps/api/src/modules/pipeline/chunk',
    ).split('\n');
    for (const name of files.filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'),
    )) {
      const destination = path.join(
        root,
        name.replace('apps/api/src/modules/', '').replace(/\.ts$/, '.js'),
      );
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(
        destination,
        ts.transpileModule(git('show', `${revision}:${name}`), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2023,
            esModuleInterop: true,
            experimentalDecorators: true,
          },
        }).outputText,
      );
    }
    const { MarkdownChunkerService } = require(
      path.join(root, 'pipeline/chunk/markdown-chunker.service.js'),
    );
    return {
      revision,
      chunker: new MarkdownChunkerService(new ConfigService(options)),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

module.exports = { snapshotChunker };
