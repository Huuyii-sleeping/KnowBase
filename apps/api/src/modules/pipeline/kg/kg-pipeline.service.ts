import { Injectable } from '@nestjs/common';
import { DocumentContentStore } from '../../documents/document-content.store';
import { MarkdownChunkerService } from '../chunk/markdown-chunker.service';
import { GraphExtractionService } from './graph-extraction.service';
import { GraphIndexService } from './graph-index.service';
import { IndexGenerationStore } from '../../indexing/index-generation.store';
import { IndexBuildService } from '../../indexing/index-build.service';

@Injectable()
export class KgPipelineService {
  constructor(
    private readonly contentStore: DocumentContentStore,
    private readonly chunker: MarkdownChunkerService,
    private readonly extractor: GraphExtractionService,
    private readonly graphIndex: GraphIndexService,
    private readonly generations: IndexGenerationStore,
    private readonly builds: IndexBuildService,
  ) {}

  async rebuildDocument(
    documentId: string,
    expectedVersion: number,
  ): Promise<{
    chunks: number;
    entities: number;
    relations: number;
    skipped?: boolean;
  }> {
    const document = await this.generations.capture(
      documentId,
      expectedVersion,
    );
    if (!document) {
      return { chunks: 0, entities: 0, relations: 0, skipped: true };
    }

    const content = await this.contentStore.findByContentId(document.contentId);
    if (!content) {
      throw new Error(`document content not found: ${document.contentId}`);
    }

    const chunks = await this.chunker.split(content.markdown);
    let counts = { chunks: 0, entities: 0, relations: 0 };
    const activated = await this.builds.build(
      document,
      'kg',
      async (generation) => {
        const graphChunks = chunks.map((chunk, index) => ({
          id: `${document.id}:v${document.version}:c${index}:${generation}`,
          documentId: document.id,
          version: document.version,
          chunkIndex: index,
          content: chunk,
        }));
        const extraction = await this.extractor.extract(graphChunks);
        await this.graphIndex.stageDocument(
          document.id,
          document.version,
          generation,
          graphChunks,
          extraction.entities,
          extraction.mentions,
          extraction.relations,
        );
        counts = {
          chunks: graphChunks.length,
          entities: extraction.entities.length,
          relations: extraction.relations.length,
        };
      },
      (generation) =>
        this.graphIndex.discardGeneration(document.id, generation),
    );
    return activated
      ? counts
      : { chunks: 0, entities: 0, relations: 0, skipped: true };
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.graphIndex.deleteDocument(documentId);
  }
}
