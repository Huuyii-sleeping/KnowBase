db = db.getSiblingDB('knowbase');

db.createCollection('document_content');

db.document_content.createIndex({ contentId: 1 }, { unique: true });
db.document_content.createIndex({ documentId: 1, version: 1 });
