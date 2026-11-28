db = db.getSiblingDB('knowbase');
db.document_evidence.createIndex({ contentId: 1, id: 1 }, { unique: true });
db.document_evidence.createIndex(
  { documentId: 1, contentId: 1, ordinal: 1 },
  { unique: true },
);
db.document_evidence.createIndex({ documentId: 1 });
db.document_evidence.createIndex({ contentId: 1 });
db.document_assets.createIndex({ objectKey: 1 }, { unique: true });
db.document_assets.createIndex({ documentId: 1 });
db.document_assets.createIndex({ createdAt: 1 });
