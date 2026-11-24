const path = require('node:path');
const { readFile, readdir } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { digest } = require('./corpus.cjs');
const root = path.resolve(__dirname, '../../../../..');
async function fingerprint(directory) {
  const files = {};
  async function walk(dir) {
    for (const item of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const file = path.join(dir, item.name);
      if (item.name === '__pycache__' || item.name.endsWith('.pyc')) continue;
      if (item.isDirectory()) await walk(file);
      else if (item.isFile())
        files[path.relative(root, file)] = digest(await readFile(file));
    }
  }
  await walk(directory);
  return { sha256: digest(JSON.stringify(files)), files };
}
function gitState() {
  return {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    workingTreeDirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
    ),
  };
}
module.exports = { root, fingerprint, gitState };
