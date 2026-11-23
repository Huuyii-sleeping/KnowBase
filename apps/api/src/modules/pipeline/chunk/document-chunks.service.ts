import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ChunkArtifactStore } from '../../ingestion/artifacts/chunk-artifact.store';
import { SourceSection } from '../../ingestion/document-structure';
import { ingestionStage } from '../../ingestion/ingestion-stage';
import { MarkdownChunkerService } from './markdown-chunker.service';

@Injectable()
export class DocumentChunksService {
  private readonly logger = new Logger(DocumentChunksService.name);
  constructor(
    private readonly chunker: MarkdownChunkerService,
    private readonly artifacts: ChunkArtifactStore,
  ) {}

  async forContent(
    documentId: string,
    contentId: string,
    content: {
      markdown: string;
      sections?: SourceSection[];
      parseStrategy?: string;
    },
  ) {
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          documentId,
          contentId,
          content.markdown,
          content.sections ?? [],
          content.parseStrategy ?? 'legacy',
          this.chunker.strategy,
        ]),
      )
      .digest('hex');
    try {
      const cached = await this.artifacts.find(key);
      if (cached) return cached;
    } catch {
      this.logger.warn(
        `Chunk artifact read unavailable for ${documentId}; recomputing.`,
      );
    }
    const chunks = await ingestionStage(
      'chunk',
      {
        documentId,
        contentId,
        strategy: this.chunker.strategy,
        characters: content.markdown.length,
      },
      () => this.chunker.splitStructured(content.markdown, content.sections),
    );
    try {
      await this.artifacts.save(documentId, key, chunks);
    } catch {
      this.logger.warn(
        `Chunk artifact write unavailable for ${documentId}; continuing with computed chunks.`,
      );
    }
    return chunks;
  }
}
