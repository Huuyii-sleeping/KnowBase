import {
  NotFoundException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DocumentContentStore } from '../../documents/document-content.store';
import { DocumentQueryService } from '../../documents/document-query.service';
import { DocumentStatus } from '../../documents/entities/document.entity';
import { MarkdownChunkerService } from '../chunk/markdown-chunker.service';
import { GraphExtractionService } from './graph-extraction.service';
import { GraphIndexService } from './graph-index.service';

@Injectable()
export class KgPipelineService {
  constructor(
    private readonly documentQuery: DocumentQueryService,
    private readonly contentStore: DocumentContentStore,
    private readonly chunker: MarkdownChunkerService,
    private readonly extractor: GraphExtractionService,
    private readonly graphIndex: GraphIndexService,
  ) {}

  async rebuildDocument(
    documentId: string,
    expectedVersion?: number,
  ): Promise<{ chunks: number; entities: number; relations: number; skipped?: boolean }> {
    let document;
    try {
      document = await this.documentQuery.findEntity(documentId);
    } catch (error) {
      if (expectedVersion !== undefined && error instanceof NotFoundException) {
        return { chunks: 0, entities: 0, relations: 0, skipped: true };
      }
      throw error;
    }
    if (expectedVersion !== undefined && document.version !== expectedVersion) {
      return { chunks: 0, entities: 0, relations: 0, skipped: true };
    }
    if (document.status !== DocumentStatus.PUBLISHED) {
      throw new UnprocessableEntityException(
        'only published documents can build the knowledge graph',
      );
    }

    const content = await this.contentStore.findByContentId(document.contentId);
    if (!content) {
      throw new Error(`document content not found: ${document.contentId}`);
    }

    const chunks = await this.chunker.split(content.markdown);
    const graphChunks = chunks.map((chunk, index) => ({
        id: `${document.id}:v${document.version}:c${index}`,
        documentId: document.id,
        version: document.version,
        chunkIndex: index,
        content: chunk,
      }));
    const extraction = await this.extractor.extract(graphChunks);
    await this.graphIndex.replaceDocument(
      document.id,
      document.version,
      graphChunks,
      extraction.entities,
      extraction.mentions,
      extraction.relations,
    );
    return {
      chunks: graphChunks.length,
      entities: extraction.entities.length,
      relations: extraction.relations.length,
    };
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.graphIndex.deleteDocument(documentId);
  }
}
