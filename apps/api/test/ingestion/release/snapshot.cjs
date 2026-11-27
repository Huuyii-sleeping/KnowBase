const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdir, writeFile, symlink } = require('node:fs/promises');
const { root, fingerprint } = require('../complex-quality/trace.cjs');
const exec = promisify(execFile);
async function compileSnapshot(ref, destination) {
  if (!/^[a-f0-9]{40}$/.test(ref))
    throw Error('Full published commit required');
  const revision = execFileSync(
    'git',
    ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  await mkdir(destination, { recursive: false });
  const archive = path.join(destination, 'source.tar');
  await writeFile(
    archive,
    execFileSync(
      'git',
      [
        'archive',
        revision,
        'apps/api/src',
        'apps/api/tsconfig.json',
        'apps/api/tsconfig.build.json',
        'apps/api/nest-cli.json',
        'apps/api/package.json',
      ],
      { cwd: root, maxBuffer: 20 * 1024 * 1024 },
    ),
  );
  await exec('tar', ['-xf', archive, '-C', destination]);
  const app = path.join(destination, 'apps/api');
  await symlink(
    path.join(root, 'apps/api/node_modules'),
    path.join(app, 'node_modules'),
    'dir',
  );
  await exec(
    process.execPath,
    [path.join(root, 'apps/api/node_modules/@nestjs/cli/bin/nest.js'), 'build'],
    { cwd: app, timeout: 120000 },
  );
  return {
    revision,
    dependencies:
      'current locked node_modules (not historical lockfile reinstall)',
    source: await fingerprint(path.join(app, 'src')),
    compiled: await fingerprint(path.join(app, 'dist')),
    entrypoint: path.join(app, 'dist/main.js'),
  };
}
module.exports = { compileSnapshot };
