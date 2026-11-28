import { IndexBuildOptions } from '../../indexing/index-build-options';
import { Injectable } from '@nestjs/common';
import { DocumentContentStore } from '../../documents/document-content.store';
import { DocumentEmbeddingService } from '../embedding/document-embedding.service';
import { RagChunkTextService } from '../chunk/rag-chunk-text.service';
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
    private readonly chunkText: RagChunkTextService,
  ) {}

  async rebuildDocument(
    documentId: string,
    expectedVersion: number,
    options?: IndexBuildOptions,
  ): Promise<{ chunks: number; skipped?: boolean }> {
    const document = await this.generations.capture(
      documentId,
      expectedVersion,
    );
    if (!document || (options && document.contentId !== options.contentId))
      return { chunks: 0, skipped: true };

    let count = 0;
    const activated = await this.builds.build(
      document,
      'rag',
      async (generation, report) => {
        await report('content');
        const content = await this.contentStore.findByContentId(
          document.contentId,
        );
        if (!content) {
          throw new Error(`document content not found: ${document.contentId}`);
        }

        await report('chunk');
        const chunks = await this.chunker.forContent(
          document.id,
          document.contentId,
          content,
        );
        const retrievalChunks = this.chunkText.forChunks(
          chunks,
          document.title,
        );
        count = chunks.length;
        await report('embedding', 0, chunks.length);
        const embeddings = chunks.length
          ? await this.embedding.embed(
              document.id,
              retrievalChunks.map((chunk) => chunk.retrievalText),
              (completed, total) => report('embedding', completed, total),
            )
          : [];
        if (embeddings.length !== chunks.length) {
          throw new Error('embedding count does not match chunk count');
        }

        const vectorChunks: VectorChunkInput[] = retrievalChunks.map(
          (chunk, index) => ({
            id: `${document.id}:v${document.version}:c${index}`,
            documentId: document.id,
            version: document.version,
            chunkIndex: index,
            content: chunk.content,
            retrievalText: chunk.retrievalText,
            metadata: {
              strategy: chunk.strategy,
              contentHash: chunk.contentHash,
              headingPath: chunk.headingPath,
              ranges: chunk.ranges,
              parseStrategy: content.parseStrategy,
              embeddingFingerprint: this.embedding.fingerprint,
            },
            embedding: embeddings[index],
          }),
        );

        await report('index_write', 0, vectorChunks.length);
        await ingestionStage(
          'index.write',
          {
            documentId,
            pipeline: 'rag',
            generation,
            chunks: vectorChunks.length,
          },
          () =>
            this.vectorIndex.stageChunks(document.id, generation, vectorChunks),
        );
        await report('index_write', vectorChunks.length, vectorChunks.length);
      },
      (generation) => this.vectorIndex.discardGeneration('rag', generation),
      options,
    );
    return activated ? { chunks: count } : { chunks: 0, skipped: true };
  }

  async deleteDocument(id: string): Promise<void> {
    await this.vectorIndex.deleteDocument(id, 'rag');
  }
}
