import { Injectable } from '@nestjs/common';
import type { DocumentIndexMessage } from '../../message-queue/message-queue.types';
import { VectorIndexService } from '../vector-index/vector-index.service';
import { IndexGenerationStore } from '../../indexing/index-generation.store';
import { IndexBuildService } from '../../indexing/index-build.service';

@Injectable()
export class SearchPipelineService {
  constructor(
    private readonly vectorIndex: VectorIndexService,
    private readonly generations: IndexGenerationStore,
    private readonly builds: IndexBuildService,
  ) {}

  async indexDocument(message: DocumentIndexMessage): Promise<void> {
    const document = await this.generations.capture(
      message.documentId,
      message.version,
    );
    if (!document) return;
    await this.builds.build(
      document,
      'search',
      (generation) =>
        this.vectorIndex.indexDocument({
          id: message.documentId,
          generation,
          document: {
            ...message.metadata,
            id: message.documentId,
            document_version: message.version,
            content: message.markdown,
          },
        }),
      (generation) => this.vectorIndex.discardGeneration('search', generation),
    );
  }

  async deleteDocument(id: string): Promise<void> {
    await this.vectorIndex.deleteDocument(id, 'search');
  }
}
