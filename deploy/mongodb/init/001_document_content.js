db = db.getSiblingDB('knowbase');

db.createCollection('document_content');

db.document_content.createIndex({ content_id: 1 }, { unique: true });
db.document_content.createIndex({ document_id: 1, version: 1 });
