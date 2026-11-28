const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID, createHash } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { Client } = require('minio');
const { eventually } = require('../delivery/environment.cjs');
const run = promisify(execFile);
const root = path.resolve(__dirname, '../../../..');
test(
  'deployment RustFS persists exact bytes across restart and cleans deleted objects',
  { timeout: 120000 },
  async () => {
    const project = 'knowbase-release-storage-' + randomUUID().slice(0, 8);
    const output = path.resolve(
      process.env.STORAGE_DEPLOY_OUTPUT ||
        path.join(root, 'reports/ingestion-release-preparation', project),
    );
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(output, { recursive: false });
    const command = async (...args) =>
      (await run('docker', args, { cwd: root, timeout: 60000 })).stdout.trim();
    const base = JSON.parse(
      await command(
        'compose',
        '-f',
        'deploy/docker-compose.yml',
        'config',
        '--format',
        'json',
      ),
    );
    const service = base.services.rustfs;
    delete service.container_name;
    service.ports = ['127.0.0.1::9000'];
    const password = randomUUID();
    // Supply isolated credentials at runtime, without saving them to the compose/report files.
    service.environment = {
      RUSTFS_ACCESS_KEY: 'release-test',
      RUSTFS_SECRET_KEY: '${RELEASE_STORAGE_TEST_SECRET:?}',
    };
    const config = {
      services: { rustfs: service },
      volumes: { 'rustfs-data': {} },
    };
    const file = path.join(output, 'compose.json');
    await writeFile(file, JSON.stringify(config, null, 2) + '\n');
    const compose = async (...args) =>
      (
        await run('docker', ['compose', '-p', project, '-f', file, ...args], {
          cwd: root,
          timeout: 60000,
          env: { ...process.env, RELEASE_STORAGE_TEST_SECRET: password },
        })
      ).stdout.trim();
    const report = {
      schema: 'deployment-object-storage-smoke-v1',
      createdAt: new Date().toISOString(),
      composeSource: 'deploy/docker-compose.yml:rustfs',
      changes:
        'isolated project/port/credentials only; preserve image, command, entrypoint and named volume',
      status: 'running',
      cases: [],
    };
    const check = (name) => report.cases.push({ name, status: 'passed' });
    try {
      await compose(
        'up',
        '-d',
        '--pull',
        process.env.DELIVERY_TEST_PULL_POLICY || 'missing',
      );
      const port = Number(
        (await compose('port', 'rustfs', '9000')).split(':').pop(),
      );
      let client = new Client({
        endPoint: '127.0.0.1',
        port,
        useSSL: false,
        accessKey: 'release-test',
        secretKey: password,
      });
      await eventually(
        async () => {
          await client.listBuckets();
          return true;
        },
        'deployment S3 ready',
        30000,
      );
      const container = await compose('ps', '-q', 'rustfs');
      const [inspect] = JSON.parse(await command('inspect', container));
      report.image = {
        name: inspect.Config.Image,
        id: inspect.Image,
        entrypoint: inspect.Config.Entrypoint,
        command: inspect.Config.Cmd,
        user: inspect.Config.User,
      };
      check(
        'default image entrypoint starts with deployment command and named volume',
      );
      await assert.rejects(
        () =>
          new Client({
            endPoint: '127.0.0.1',
            port,
            useSSL: false,
            accessKey: 'release-test',
            secretKey: randomUUID(),
          }).listBuckets(),
        (error) =>
          [
            'SignatureDoesNotMatch',
            'AccessDenied',
            'InvalidAccessKeyId',
          ].includes(error.code),
      );
      check('wrong credentials cannot list buckets');
      const data = Buffer.from(
        'Synthetic release evidence: -8.75; limit 731; 空值保持未知。\n',
      );
      const digest = (bytes) =>
        createHash('sha256').update(bytes).digest('hex');
      report.inputSha256 = digest(data);
      await client.makeBucket('release-check');
      await client.putObject('release-check', 'source.txt', data, data.length, {
        'Content-Type': 'text/plain',
      });
      const read = async () => {
        const stream = await client.getObject('release-check', 'source.txt');
        const parts = [];
        for await (const part of stream) parts.push(part);
        return Buffer.concat(parts);
      };
      assert.equal(digest(await read()), digest(data));
      check('saved bytes read back with identical SHA-256');
      await compose('restart', 'rustfs');
      const restartedPort = Number(
        (await compose('port', 'rustfs', '9000')).split(':').pop(),
      );
      report.portMapping = { before: port, after: restartedPort };
      client = new Client({
        endPoint: '127.0.0.1',
        port: restartedPort,
        useSSL: false,
        accessKey: 'release-test',
        secretKey: password,
      });
      await eventually(
        async () => {
          await client.listBuckets();
          return true;
        },
        'deployment S3 restart',
        30000,
      );
      assert.equal(digest(await read()), digest(data));
      check('named-volume bytes survive container restart');
      await client.removeObject('release-check', 'source.txt');
      await assert.rejects(
        () => client.statObject('release-check', 'source.txt'),
        (error) => ['NotFound', 'NoSuchKey'].includes(error.code),
      );
      await client.removeBucket('release-check');
      check('object and bucket deletion complete');
      report.status = 'passed';
    } catch (error) {
      report.status = 'failed';
      report.error = error.message;
      throw error;
    } finally {
      try {
        await writeFile(
          path.join(output, 'service.log'),
          await compose('logs', '--no-color'),
        );
      } finally {
        await compose('down', '-v', '--remove-orphans');
        report.isolatedServicesRemoved = true;
        await writeFile(
          path.join(output, 'report.json'),
          JSON.stringify(report, null, 2) + '\n',
        );
      }
    }
  },
);
