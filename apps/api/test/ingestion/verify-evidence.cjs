// Real MinerU -> real object storage -> independent Mongo evidence -> read/verify/delete.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID, createHash } = require('node:crypto');
const { mkdir, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const { ConfigService } = require('@nestjs/config');
const { PNG } = require('pngjs');
const { load, parserRuntime } = require('./runtime.cjs');
const run = promisify(execFile);
const composeArgs = [
  'compose',
  '-f',
  path.resolve(
    __dirname,
    '../../../../deploy/docker-compose.ingestion-test.yml',
  ),
  '-p',
  `knowbase-evidence-quality-${process.pid}`,
];
const compose = (...args) =>
  run('docker', [...composeArgs, ...args], { timeout: 120000 });
async function read(stream) {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
}
(async () => {
  let connection;
  const report = {
    generatedAt: new Date().toISOString(),
    status: 'running',
    cases: [],
  };
  const dir = path.resolve(__dirname, '../../../../reports/ingestion-evidence');
  await mkdir(dir, { recursive: true });
  try {
    await compose(
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '90',
      '--pull',
      process.env.DELIVERY_TEST_PULL_POLICY || 'missing',
    );
    const port = async (service, port) =>
      Number(
        (await compose('port', service, port)).stdout.trim().split(':').pop(),
      );
    connection = await mongoose
      .createConnection(
        `mongodb://127.0.0.1:${await port('mongo', '27017')}/evidence`,
      )
      .asPromise();
    const { EVIDENCE_MODEL, EvidenceSchema } = load(
      'documents/evidence/evidence.schema.js',
    );
    const { ASSET_REGISTRY_MODEL, AssetRegistrySchema } = load(
      'storage/asset-registry.schema.js',
    );
    const { DocumentContentSchema } = load(
      'documents/schemas/document-content.schema.js',
    );
    const evidenceModel = connection.model(EVIDENCE_MODEL, EvidenceSchema);
    const assetModel = connection.model(
      ASSET_REGISTRY_MODEL,
      AssetRegistrySchema,
    );
    const contentModel = connection.model(
      'DocumentContent',
      DocumentContentSchema,
    );
    await Promise.all([
      evidenceModel.init(),
      assetModel.init(),
      contentModel.init(),
    ]);
    const config = new ConfigService({
      RUSTFS_ENDPOINT: '127.0.0.1',
      RUSTFS_PORT: await port('object-storage', '9000'),
      RUSTFS_ACCESS_KEY: 'ingestion-test',
      RUSTFS_SECRET_KEY: 'ingestion-test-password',
      RUSTFS_BUCKET: 'evidence-quality',
      MINERU_BASE_URL: process.env.MINERU_BASE_URL || 'http://127.0.0.1:8000',
      MINERU_TIER: 'flash',
    });
    const storage = new (load('storage/storage.service.js').StorageService)(
      config,
      assetModel,
    );
    const cleanup = new (load(
      'documents/document-assets-cleanup.service.js',
    ).DocumentAssetsCleanupService)(storage);
    const uploader = new (load(
      'documents/parsing/asset-uploader.service.js',
    ).AssetUploaderService)(storage, {
      enqueueStandalone: async (_routing, message) =>
        cleanup.cleanup(message.documentId, message.keys),
    });
    const { parser } = parserRuntime(
      {
        DOCUMENT_PARSER: 'mineru',
        MINERU_BASE_URL: config.get('MINERU_BASE_URL'),
        XLS_EVIDENCE_PYTHON: process.env.XLS_EVIDENCE_PYTHON || '',
      },
      uploader,
    );
    const evidence = new (load(
      'documents/evidence/document-evidence.store.js',
    ).DocumentEvidenceStore)(evidenceModel);
    const verifier = new (load(
      'documents/evidence/document-artifact-verifier.js',
    ).DocumentArtifactVerifier)(storage);
    const content = new (load(
      'documents/document-content.store.js',
    ).DocumentContentStore)(contentModel, evidence, verifier);
    const fixtures = await require('./fixtures.cjs').fixtures();
    const image = new PNG({ width: 30, height: 20 });
    image.data.fill(255);
    const html = Buffer.from(
      `<html><body><h1>Release evidence</h1><p>Storage cost is 100.</p><table><tr><th>Team</th><th>Cost</th></tr><tr><td rowspan="2">Research</td><td>100</td></tr><tr><td>200</td></tr></table><img alt="source" src="data:image/png;base64,${PNG.sync.write(image).toString('base64')}"></body></html>`,
    );
    const cases = [
      ...fixtures.filter((item) => !item.invalid),
      { name: 'snapshot.html', data: html },
    ];
    if (process.env.QUALITY_CORPUS) {
      const { loadCorpus } = require('./quality/corpus.cjs');
      const corpus = await loadCorpus(process.env.QUALITY_CORPUS);
      report.corpusManifestSha256 = corpus.manifestSha256;
      report.corpusProvenance = corpus.provenance;
      for (const item of corpus.cases)
        cases.push({
          name: item.file,
          data: await readFile(path.join(corpus.root, item.file)),
          qualityGold: item,
        });
    }
    if (process.env.LEGACY_TEST_FIXTURE_DIR)
      for (const [name, modern] of [
        ['review.doc', 'docx'],
        ['slides.ppt', 'pptx'],
        ['costs.xls', 'xlsx'],
      ])
        cases.push({
          name,
          data: await readFile(
            path.join(process.env.LEGACY_TEST_FIXTURE_DIR, name),
          ),
          facts: fixtures.find((item) => item.name.endsWith('.' + modern))
            .facts,
        });
    if (process.env.WEB_TEST_SNAPSHOT)
      cases.push({
        name: 'public.websnapshot',
        data: await readFile(process.env.WEB_TEST_SNAPSHOT),
      });
    for (const fixture of cases) {
      const documentId = randomUUID(),
        contentId = randomUUID();
      const originalKey = `original/${documentId}/${fixture.name}`;
      await storage.putObject(
        originalKey,
        fixture.data,
        'application/octet-stream',
      );
      assert.deepEqual(
        await read(await storage.getObject(originalKey)),
        fixture.data,
      );
      const started = performance.now();
      const result = await parser.parse(fixture.data, fixture.name, documentId);
      assert.notEqual(result.quality?.status, 'failed', fixture.name);
      const metrics = {};
      for (const fact of fixture.facts || [])
        assert.ok(
          result.markdown.includes(fact),
          fixture.name + ': missing source fact',
        );
      await content.create({ ...result, documentId, contentId, version: 1 });
      await content.verifyEvidence(contentId);
      const stored = await content.findByContentId(contentId);
      const rows = await evidence.page(documentId, contentId, 0, 100);
      assert.equal(rows.length, stored.evidenceManifest.count);
      if (fixture.qualityGold) {
        const { scoreDocument } = require('./quality/metrics.cjs');
        metrics.quality = scoreDocument(
          {
            ...stored,
            blocks: (stored.tables || []).map((table) => ({ table })),
            evidence: rows,
          },
          fixture.qualityGold,
        );
        assert.equal(
          metrics.quality.passed,
          true,
          `${fixture.name}: persisted quality mismatch`,
        );
        if (Object.hasOwn(fixture.qualityGold, 'expectedHeaderPage')) {
          const tables = stored.blocks.filter((block) => block.tableId);
          assert.deepEqual(
            tables.map((block) => block.source.page),
            [1, 2],
          );
          assert.equal(
            tables[1].source.tableHeaderPage ?? null,
            fixture.qualityGold.expectedHeaderPage,
          );
          assert.equal(
            rows
              .filter((row) => row.kind === 'table' && row.source.page === 2)
              .every(
                (row) =>
                  (row.source.tableHeaderPage ?? null) ===
                  fixture.qualityGold.expectedHeaderPage,
              ),
            true,
          );
        }
      } else if (fixture.name.endsWith('.xlsx')) {
        const native = rows.filter((row) => row.kind === 'worksheet_row');
        assert.equal(native.length, 3);
        assert.equal(native[1].data.cells[1].value, 100);
        assert.equal(native[2].data.cells[1].value, 200);
        assert.equal(native[1].source.sheet, '费用');
        assert.equal(native[1].source.cellRange, 'A2:B2');
      } else if (fixture.name.endsWith('.html')) {
        assert.ok(stored.markdown.includes('Storage cost is 100'));
        const images = rows.filter((row) => row.kind === 'image');
        assert.equal(images.length, 1);
        assert.equal(images[0].objectKeys.length, 1);
        assert.equal(images[0].data.imageAvailable, true);
        assert.ok(
          rows.some(
            (row) =>
              row.kind === 'table' &&
              row.data.cells.some((cell) => cell.rowSpan === 2),
          ),
        );
      }
      if (fixture.name.endsWith('.websnapshot')) {
        const snapshot = rows.find((row) => row.kind === 'web_snapshot');
        assert.equal(snapshot.data.sha256, JSON.parse(fixture.data).sha256);
        assert.ok(stored.markdown.includes('Example Domain'));
        assert.equal(result.ready, false);
      }
      for (const asset of stored.assets) {
        const bytes = await read(await storage.getObject(asset.objectKey));
        assert.equal(bytes.length, asset.bytes);
        assert.equal(
          createHash('sha256').update(bytes).digest('hex'),
          asset.sha256,
        );
        assert.equal(
          (await storage.statObject(asset.objectKey)).metaData['content-type'],
          asset.contentType,
        );
        if (bytes.length > 10)
          assert.deepEqual(
            await read(await storage.getPartialObject(asset.objectKey, 2, 7)),
            bytes.subarray(2, 9),
          );
      }
      const keys = await storage.assetKeys(documentId);
      assert.equal(keys.length, stored.assets.length);
      await cleanup.cleanup(documentId, keys);
      await content.deleteByDocumentId(documentId);
      await storage.removeObject(originalKey);
      await assert.rejects(storage.statObject(originalKey));
      assert.equal(await evidenceModel.countDocuments({ documentId }), 0);
      assert.equal(await assetModel.countDocuments({ documentId }), 0);
      assert.equal(await content.findByContentId(contentId), null);
      for (const key of keys) await assert.rejects(storage.statObject(key));
      report.cases.push({
        name: fixture.name,
        inputSha256: createHash('sha256').update(fixture.data).digest('hex'),
        inputBytes: fixture.data.length,
        parser: result.provenance,
        ready: result.ready,
        evidenceCount: rows.length,
        assetCount: stored.assets.length,
        elapsedMs: performance.now() - started,
        metrics,
        hashesVerified: true,
        cleanupVerified: true,
      });
    }
    report.status = 'passed';
    await writeFile(
      path.join(dir, 'verification.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (report.status !== 'passed') report.status = 'failed';
    await writeFile(
      path.join(dir, 'verification.json'),
      JSON.stringify(report, null, 2),
    );
    await connection?.close();
    await compose('down', '-v', '--remove-orphans');
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
