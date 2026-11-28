db = db.getSiblingDB('knowbase');

db.ingestion_chunks.createIndex({ key: 1, index: 1 }, { unique: true });
db.ingestion_chunks.createIndex({ documentId: 1 });
db.ingestion_chunks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

db.ingestion_embeddings.createIndex({ key: 1 }, { unique: true });
db.ingestion_embeddings.createIndex({ documentId: 1 });
db.ingestion_embeddings.createIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
);
