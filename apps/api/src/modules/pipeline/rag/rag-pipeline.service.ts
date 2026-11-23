import { Injectable } from '@nestjs/common';
import { DocumentContentStore } from '../../documents/document-content.store';
import { DocumentEmbeddingService } from '../embedding/document-embedding.service';
import { DocumentChunksService } from '../chunk/document-chunks.service';
import { ingestionStage } from '../../ingestion/ingestion-stage';
import {
  VectorChunkInput,
  VectorIndexService,
} from '../vector-index/vector-index.service';
import { IndexGenerationStore } from '../../indexing/index-generation.store';
import { IndexBuildService } from '../../indexing/index-build.service';

@Injectable()
export class RagPipelineService {
  constructor(
    private readonly contentStore: DocumentContentStore,
    private readonly chunker: DocumentChunksService,
    private readonly embedding: DocumentEmbeddingService,
    private readonly vectorIndex: VectorIndexService,
    private readonly generations: IndexGenerationStore,
    private readonly builds: IndexBuildService,
  ) {}

  async rebuildDocument(
    documentId: string,
    expectedVersion: number,
  ): Promise<{ chunks: number; skipped?: boolean }> {
    const document = await this.generations.capture(
      documentId,
      expectedVersion,
    );
    if (!document) return { chunks: 0, skipped: true };

    const content = await this.contentStore.findByContentId(document.contentId);
    if (!content) {
      throw new Error(`document content not found: ${document.contentId}`);
    }

    const chunks = await this.chunker.forContent(
      document.id,
      document.contentId,
      content,
    );
    const embeddings = chunks.length
      ? await this.embedding.embed(
          document.id,
          chunks.map((chunk) => chunk.embeddingText),
        )
      : [];
    if (embeddings.length !== chunks.length) {
      throw new Error('embedding count does not match chunk count');
    }

    const vectorChunks: VectorChunkInput[] = chunks.map((chunk, index) => ({
      id: `${document.id}:v${document.version}:c${index}`,
      documentId: document.id,
      version: document.version,
      chunkIndex: index,
      content: chunk.content,
      metadata: {
        strategy: chunk.strategy,
        contentHash: chunk.contentHash,
        headingPath: chunk.headingPath,
        ranges: chunk.ranges,
        parseStrategy: content.parseStrategy,
        embeddingFingerprint: this.embedding.fingerprint,
      },
      embedding: embeddings[index],
    }));

    const activated = await this.builds.build(
      document,
      'rag',
      (generation) =>
        ingestionStage(
          'index.write',
          {
            documentId,
            pipeline: 'rag',
            generation,
            chunks: vectorChunks.length,
          },
          () =>
            this.vectorIndex.stageChunks(document.id, generation, vectorChunks),
        ),
      (generation) => this.vectorIndex.discardGeneration('rag', generation),
    );
    return activated
      ? { chunks: vectorChunks.length }
      : { chunks: 0, skipped: true };
  }

  async deleteDocument(id: string): Promise<void> {
    await this.vectorIndex.deleteDocument(id, 'rag');
  }
}
