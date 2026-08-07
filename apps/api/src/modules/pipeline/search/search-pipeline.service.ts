import { Injectable } from '@nestjs/common';
import type { DocumentIndexMessage } from '../../message-queue/message-queue.types';
import { VectorIndexService } from '../vector-index/vector-index.service';

@Injectable()
export class SearchPipelineService {
  constructor(private readonly vectorIndex: VectorIndexService) {}

  async indexDocument(message: DocumentIndexMessage): Promise<void> {
    await this.vectorIndex.indexDocument({
      id: message.documentId,
      document: {
        id: message.documentId,
        document_version: message.version,
        ...message.metadata,
        content: message.markdown,
      },
    });
  }
}
