const assert = require('node:assert/strict');
const path = require('node:path');
const { readFile, mkdir, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { loadCorpus, digest } = require('./corpus.cjs');
const { score } = require('./score.cjs');
const { tableBodyAudit } = require('./table-body-audit.cjs');
const {
  assertTablesPreserved,
  tableChunkDelivery,
} = require('./table-delivery.cjs');
const {
  readCase,
  rewriteResult,
  assertContentPreserved,
  visualChunkDelivery,
  validateDeliveryRun,
} = require('./delivery-artifacts.cjs');
const {
  isolatedEnvironment,
  cleanupAll,
} = require('./delivery-environment.cjs');
const { deliveryStores } = require('./delivery-stores.cjs');
const { deliveryIndex } = require('./delivery-index.cjs');
const { fingerprint, root, gitState } = require('./trace.cjs');
async function verifyDelivery(corpusDir, runDir, output) {
  const corpus = await loadCorpus(corpusDir);
  const runBytes = await readFile(path.join(runDir, 'run.json'));
  const run = JSON.parse(runBytes);
  validateDeliveryRun(run, corpus);
  await mkdir(output, { recursive: false });
  const report = {
    schema: 'complex-delivery-v1',
    generatedAt: new Date().toISOString(),
    git: gitState(),
    runSha256: digest(runBytes),
    manifestSha256: corpus.manifestSha256,
    source: await fingerprint(path.join(root, 'apps/api/src/modules')),
    tool: await fingerprint(__dirname),
    scope:
      'Replay real parser observations through isolated Mongo/object storage, production chunker, real embedding and staged Elasticsearch writer. No publication, generation activation, HTTP permissions, retrieval or answer-quality claim.',
    embeddingRevision: process.env.QUALITY_EMBEDDING_REVISION,
    status: 'running',
    cases: [],
  };
  let environment, stores, index;
  let setup = 'isolated_services';
  const flush = () =>
    writeFile(
      path.join(output, 'delivery.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  try {
    environment = await isolatedEnvironment();
    setup = 'storage_connection';
    stores = await deliveryStores(environment.ports);
    setup = 'index_connection';
    index = await deliveryIndex(environment.ports.elasticsearch);
    for (const row of run.cases) {
      const item = corpus.manifest.cases.find((x) => x.id === row.id);
      if (
        row.status !== 'completed' ||
        row.parser === 'failed' ||
        row.parserQuality === 'failed'
      ) {
        report.cases.push({
          id: row.id,
          status: 'unavailable',
          reason: 'SOURCE_PARSE_NOT_COMPLETED',
        });
        continue;
      }
      const documentId = randomUUID(),
        generation = randomUUID(),
        contentId = randomUUID();
      const entry = {
        id: row.id,
        inputSha256: row.inputSha256,
        status: 'running',
      };
      report.cases.push(entry);
      let stage = 'artifact_read';
      try {
        const { result, assets, parsedSha256, inventorySha256 } =
          await readCase(runDir, row);
        Object.assign(entry, { parsedSha256, inventorySha256 });
        const replacements = new Map();
        stage = 'asset_upload';
        for (const asset of assets) {
          const parsed = result.assets.find(
            (x) => x.objectKey === asset.objectKey,
          );
          replacements.set(
            asset.objectKey,
            await stores.uploader.upload(documentId, {
              fileName: asset.file,
              contentType: asset.mime,
              data: asset.data,
              type: parsed.type,
              alt: parsed.alt,
            }),
          );
        }
        const input = rewriteResult(result, replacements);
        stage = 'content_write';
        await stores.content.create({
          ...input,
          documentId,
          contentId,
          version: 1,
        });
        await stores.content.verifyEvidence(contentId);
        const stored = await stores.content.findByContentId(contentId);
        const units = await stores.evidence.page(
          documentId,
          contentId,
          0,
          10000,
        );
        assert.equal(units.length, stored.evidenceManifest.count);
        assertContentPreserved(input, stored, units);
        assertTablesPreserved(input, stored);
        stage = 'asset_readback';
        await stores.readAssets(stored.assets);
        const persisted = {
          ...stored,
          evidence: units,
          blocks: (stored.tables || []).map((table) => ({
            table,
            source: table.source,
          })),
        };
        const before = score(input, corpus.gold.get(item.id)),
          after = score(persisted, corpus.gold.get(item.id));
        assert.deepEqual(before, row.score);
        assert.deepEqual(after, before);
        const bodyAudit = tableBodyAudit(
          input,
          corpus.gold.get(item.id).tables,
        );
        assert.deepEqual(
          tableBodyAudit(persisted, corpus.gold.get(item.id).tables),
          bodyAudit,
        );
        stage = 'chunk_embedding_index';
        const indexed = await index.stage(documentId, stored, generation);
        const visual = visualChunkDelivery(persisted, indexed.chunks);
        const tableRows = tableChunkDelivery(stored, indexed.chunks);
        assert.ok(
          tableRows.every((row) => row.expectedRows === row.matchedRows),
          'Table rows lost header, value or source',
        );
        stage = 'visual_chunk_delivery';
        assert.ok(
          visual.every(
            (x) => x.preservedParts === x.expectedParts && x.sourceChunks > 0,
          ),
          'Visual description lost in chunks',
        );
        Object.assign(entry, {
          status: 'passed',
          qualityUnchanged: true,
          assetsVerified: stored.assets.length,
          evidenceVerified: units.length,
          chunksVerified: indexed.chunks.length,
          vectorsVerified: indexed.vectors,
          strategy: indexed.strategy,
          embeddingFingerprint: indexed.embeddingFingerprint,
          visual,
          tableBodyAudit: bodyAudit,
          tableRows,
          qualityPassed: after.automaticChecksPassed,
        });
      } catch {
        entry.status = 'failed';
        entry.reason = 'DELIVERY_ASSERTION_FAILED';
        entry.stage = stage;
      } finally {
        try {
          await cleanupAll([
            () => index.cleanup(generation),
            () => stores.cleanup(documentId),
          ]);
          entry.cleanupVerified = true;
        } catch {
          entry.status = 'failed';
          entry.cleanupVerified = false;
        }
        await flush();
      }
    }
    report.status = report.cases.every((x) => x.status === 'passed')
      ? 'passed'
      : 'failed';
    return report;
  } catch {
    report.setupFailure = setup;
    report.status = 'failed';
    return report;
  } finally {
    if (report.status === 'running') report.status = 'failed';
    try {
      await cleanupAll([
        () => index?.client.close(),
        () => stores?.connection.close(),
        async () => {
          if (environment) {
            await environment.close();
            report.isolatedServicesRemoved = true;
          }
        },
      ]);
    } catch {
      report.status = 'failed';
      report.cleanupFailure = true;
    } finally {
      await flush();
    }
  }
}
if (require.main === module) {
  if (process.argv.length !== 5)
    throw new Error('Usage: verify-delivery.cjs CORPUS SOURCE_RUN NEW_OUTPUT');
  verifyDelivery(...process.argv.slice(2).map((x) => path.resolve(x)))
    .then((report) => {
      console.table(report.cases);
      if (report.status !== 'passed') process.exitCode = 1;
    })
    .catch(() => {
      console.error(
        'Isolated delivery verification failed; inspect the retained report.',
      );
      process.exitCode = 1;
    });
}
module.exports = { verifyDelivery };
