import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CHUNK_ARTIFACT_MODEL,
  EMBEDDING_CACHE_MODEL,
  ChunkArtifactSchema,
  EmbeddingCacheSchema,
} from './artifact.schemas';
import { ChunkArtifactStore } from './chunk-artifact.store';
import { EmbeddingCacheStore } from './embedding-cache.store';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CHUNK_ARTIFACT_MODEL, schema: ChunkArtifactSchema },
      { name: EMBEDDING_CACHE_MODEL, schema: EmbeddingCacheSchema },
    ]),
  ],
  providers: [ChunkArtifactStore, EmbeddingCacheStore],
  exports: [ChunkArtifactStore, EmbeddingCacheStore],
})
export class IngestionArtifactsModule {}
