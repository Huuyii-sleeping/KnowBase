import { Injectable } from '@nestjs/common';
import { DocumentContentStore } from './document-content.store';
import { StorageService } from '../storage/storage.service';
import { IndexGenerationStore } from '../indexing/index-generation.store';
import { ChunkArtifactStore } from '../ingestion/artifacts/chunk-artifact.store';
import { EmbeddingCacheStore } from '../ingestion/artifacts/embedding-cache.store';
import { DocumentAssetsCleanupService } from './document-assets-cleanup.service';

@Injectable()
export class DocumentSourceCleanupService {
  constructor(
    private readonly content: DocumentContentStore,
    private readonly storage: StorageService,
    private readonly generations: IndexGenerationStore,
    private readonly chunks: ChunkArtifactStore,
    private readonly embeddings: EmbeddingCacheStore,
    private readonly assets: DocumentAssetsCleanupService,
  ) {}

  async cleanup(documentId: string, storageKey: string): Promise<void> {
    if (!(await this.generations.isDeleted(documentId, 'kg'))) return;
    // Keep content references until all asset removals succeed, so retries can
    // still discover the same keys after a storage failure.
    await this.assets.cleanup(
      documentId,
      await this.content.assetKeys(documentId),
    );
    await this.chunks.deleteDocument(documentId);
    await this.embeddings.deleteDocument(documentId);
    await this.content.deleteByDocumentId(documentId);
    await this.storage.removeObject(storageKey);
  }
}
