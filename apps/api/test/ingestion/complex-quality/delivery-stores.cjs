const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { ConfigService } = require('@nestjs/config');
const { load } = require('../runtime.cjs');
const { digest } = require('./corpus.cjs');
async function bytes(stream) {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
}
async function deliveryStores(ports) {
  const connection = await mongoose
    .createConnection(`mongodb://127.0.0.1:${ports.mongo}/complex_quality`)
    .asPromise();
  try {
    const evidenceSchema = load('documents/evidence/evidence.schema.js');
    const assetSchema = load('storage/asset-registry.schema.js');
    const evidenceModel = connection.model(
      evidenceSchema.EVIDENCE_MODEL,
      evidenceSchema.EvidenceSchema,
    );
    const assetModel = connection.model(
      assetSchema.ASSET_REGISTRY_MODEL,
      assetSchema.AssetRegistrySchema,
    );
    const contentModel = connection.model(
      'DocumentContent',
      load('documents/schemas/document-content.schema.js')
        .DocumentContentSchema,
    );
    await Promise.all([
      evidenceModel.init(),
      assetModel.init(),
      contentModel.init(),
    ]);
    const storage = new (load('storage/storage.service.js').StorageService)(
      new ConfigService({
        RUSTFS_ENDPOINT: '127.0.0.1',
        RUSTFS_PORT: ports.object,
        RUSTFS_ACCESS_KEY: 'ingestion-test',
        RUSTFS_SECRET_KEY: 'ingestion-test-password',
        RUSTFS_BUCKET: 'complex-quality',
      }),
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
    const evidence = new (load(
      'documents/evidence/document-evidence.store.js',
    ).DocumentEvidenceStore)(evidenceModel);
    const verifier = new (load(
      'documents/evidence/document-artifact-verifier.js',
    ).DocumentArtifactVerifier)(storage);
    const content = new (load(
      'documents/document-content.store.js',
    ).DocumentContentStore)(contentModel, evidence, verifier);
    return {
      storage,
      uploader,
      content,
      evidence,
      connection,
      async readAssets(assets) {
        for (const asset of assets) {
          const body = await bytes(await storage.getObject(asset.objectKey));
          assert.equal(digest(body), asset.sha256);
          assert.equal(body.length, asset.bytes);
          assert.equal(
            (await storage.statObject(asset.objectKey)).metaData[
              'content-type'
            ],
            asset.contentType,
          );
        }
      },
      async cleanup(documentId) {
        const keys = await storage.assetKeys(documentId);
        await cleanup.cleanup(documentId, keys);
        await content.deleteByDocumentId(documentId);
        assert.equal(await evidenceModel.countDocuments({ documentId }), 0);
        assert.equal(await contentModel.countDocuments({ documentId }), 0);
        assert.equal(await assetModel.countDocuments({ documentId }), 0);
        for (const key of keys) await assert.rejects(storage.statObject(key));
      },
    };
  } catch (error) {
    await connection.close();
    throw error;
  }
}
module.exports = { deliveryStores };
