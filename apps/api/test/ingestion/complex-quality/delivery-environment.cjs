const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { root } = require('./trace.cjs');
const run = promisify(execFile);
async function cleanupAll(actions) {
  const outcomes = await Promise.allSettled(
    actions.map((action) => Promise.resolve().then(action)),
  );
  if (outcomes.some((x) => x.status === 'rejected'))
    throw new Error('Isolated cleanup incomplete');
}
async function isolatedEnvironment() {
  const project = `knowbase-complex-${randomUUID().slice(0, 8)}`;
  const prefix = [
    'compose',
    '-f',
    path.join(root, 'deploy/docker-compose.ingestion-test.yml'),
    '-f',
    path.join(root, 'deploy/docker-compose.complex-quality-test.yml'),
    '-p',
    project,
  ];
  const compose = (...args) =>
    run('docker', [...prefix, ...args], {
      timeout: 150000,
      maxBuffer: 1024 * 1024,
    });
  const port = async (service, port) =>
    Number(
      (await compose('port', service, port)).stdout.trim().split(':').pop(),
    );
  try {
    await compose(
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '120',
      '--pull',
      'missing',
    );
    return {
      project,
      ports: {
        mongo: await port('mongo', '27017'),
        object: await port('object-storage', '9000'),
        elasticsearch: await port('elasticsearch', '9200'),
      },
      close: () => compose('down', '-v', '--remove-orphans'),
    };
  } catch (error) {
    await compose('down', '-v', '--remove-orphans');
    throw error;
  }
}
module.exports = { isolatedEnvironment, cleanupAll };
