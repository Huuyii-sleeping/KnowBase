import { Schema } from 'mongoose';

export const CHUNK_ARTIFACT_MODEL = 'IngestionChunkArtifact';
export const EMBEDDING_CACHE_MODEL = 'IngestionEmbeddingCache';

export const ChunkArtifactSchema = new Schema(
  {
    documentId: { type: String, required: true },
    key: { type: String, required: true },
    index: { type: Number, required: true },
    chunk: Object,
    count: Number,
    digest: String,
    expiresAt: { type: Date, required: true },
  },
  { collection: 'ingestion_chunks' },
);
ChunkArtifactSchema.index({ key: 1, index: 1 }, { unique: true });
ChunkArtifactSchema.index({ documentId: 1 });
ChunkArtifactSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmbeddingCacheSchema = new Schema(
  {
    documentId: { type: String, required: true },
    key: { type: String, required: true, unique: true },
    vector: { type: [Number], required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'ingestion_embeddings' },
);
EmbeddingCacheSchema.index({ documentId: 1 });
EmbeddingCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
