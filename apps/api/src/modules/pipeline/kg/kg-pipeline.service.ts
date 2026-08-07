import {
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DocumentContentStore } from '../../documents/document-content.store';
import { DocumentQueryService } from '../../documents/document-query.service';
import { DocumentStatus } from '../../documents/entities/document.entity';
import { MarkdownChunkerService } from '../chunk/markdown-chunker.service';
import { GraphIndexService } from './graph-index.service';

@Injectable()
export class KgPipelineService {
  constructor(
    private readonly documentQuery: DocumentQueryService,
    private readonly contentStore: DocumentContentStore,
    private readonly chunker: MarkdownChunkerService,
    private readonly graphIndex: GraphIndexService,
  ) {}

  async rebuildDocument(documentId: string): Promise<{ chunks: number }> {
    const document = await this.documentQuery.findEntity(documentId);
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
    await this.graphIndex.replaceDocument(
      document.id,
      document.version,
      chunks.map((chunk, index) => ({
        id: `${document.id}:v${document.version}:c${index}`,
        documentId: document.id,
        version: document.version,
        chunkIndex: index,
        content: chunk,
      })),
    );
    return { chunks: chunks.length };
  }
}
