import {
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DocumentContentStore } from '../../documents/document-content.store';
import { DocumentQueryService } from '../../documents/document-query.service';
import { DocumentStatus } from '../../documents/entities/document.entity';
import { EmbeddingService } from '../embedding/embedding.service';
import { MarkdownChunkerService } from '../chunk/markdown-chunker.service';
import {
  VectorChunkInput,
  VectorIndexService,
} from '../vector-index/vector-index.service';

@Injectable()
export class RagPipelineService {
  constructor(
    private readonly documentQuery: DocumentQueryService,
    private readonly contentStore: DocumentContentStore,
    private readonly chunker: MarkdownChunkerService,
    private readonly embedding: EmbeddingService,
    private readonly vectorIndex: VectorIndexService,
  ) {}

  async rebuildDocument(documentId: string): Promise<{ chunks: number }> {
    const document = await this.documentQuery.findEntity(documentId);
    if (document.status !== DocumentStatus.PUBLISHED) {
      throw new UnprocessableEntityException(
        'only published documents can build the RAG index',
      );
    }

    const content = await this.contentStore.findByContentId(document.contentId);
    if (!content) {
      throw new Error(`document content not found: ${document.contentId}`);
    }

    const chunks = await this.chunker.split(content.markdown);
    const embeddings = await this.embedding.embedDocuments(chunks);
    if (embeddings.length !== chunks.length) {
      throw new Error('embedding count does not match chunk count');
    }

    const vectorChunks: VectorChunkInput[] = chunks.map((chunk, index) => ({
      id: `${document.id}:v${document.version}:c${index}`,
      documentId: document.id,
      version: document.version,
      chunkIndex: index,
      content: chunk,
      embedding: embeddings[index],
    }));

    await this.vectorIndex.replaceChunks(document.id, vectorChunks);
    return { chunks: vectorChunks.length };
  }
}
