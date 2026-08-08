db = db.getSiblingDB('knowbase');

if (db.document_content.getIndexes().some((index) => index.name === 'content_id_1')) {
  db.document_content.dropIndex('content_id_1');
}

if (
  db.document_content
    .getIndexes()
    .some((index) => index.name === 'document_id_1_version_1')
) {
  db.document_content.dropIndex('document_id_1_version_1');
}

db.document_content.createIndex({ contentId: 1 }, { unique: true });
db.document_content.createIndex({ documentId: 1, version: 1 });
