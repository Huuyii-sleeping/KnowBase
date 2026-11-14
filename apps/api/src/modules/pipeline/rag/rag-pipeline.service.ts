import { Injectable } from '@nestjs/common';
import { DocumentContentStore } from '../../documents/document-content.store';
import { EmbeddingService } from '../embedding/embedding.service';
import { RagChunkTextService } from '../chunk/rag-chunk-text.service';
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
    private readonly chunkText: RagChunkTextService,
    private readonly embedding: EmbeddingService,
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

    const chunks = await this.chunkText.prepare(
      content.markdown,
      document.title,
    );
    const embeddings = chunks.length
      ? await this.embedding.embedDocuments(
          chunks.map((chunk) => chunk.retrievalText),
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
      retrievalText: chunk.retrievalText,
      embedding: embeddings[index],
    }));

    const activated = await this.builds.build(
      document,
      'rag',
      (generation) =>
        this.vectorIndex.stageChunks(document.id, generation, vectorChunks),
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
