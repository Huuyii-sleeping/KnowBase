import { Injectable } from '@nestjs/common';
import { MESSAGE_ROUTING_KEYS } from '../message-queue/message-queue.constants';
import { MessageQueueService } from '../message-queue/message-queue.service';
import type {
  DocumentIndexMessage,
  DocumentPipelineCommand,
} from '../message-queue/message-queue.types';
import { DocumentContentStore } from './document-content.store';
import { DocumentQueryService } from './document-query.service';

@Injectable()
export class DocumentPipelinePublisher {
  constructor(
    private readonly messageQueue: MessageQueueService,
    private readonly documentQuery: DocumentQueryService,
    private readonly contentStore: DocumentContentStore,
  ) {}

  async publishDocument(documentId: string): Promise<void> {
    const document = await this.documentQuery.findOne(documentId, false);
    const content = await this.contentStore.findByContentId(document.contentId);

    if (!content) {
      throw new Error(`document content not found: ${document.contentId}`);
    }

    const indexMessage: DocumentIndexMessage = {
      type: 'DOCUMENT_INDEX',
      documentId: document.id,
      version: document.version,
      metadata: document,
      markdown: content.markdown,
    };
    const pipelineCommand: DocumentPipelineCommand = {
      type: 'DOCUMENT_PIPELINE_COMMAND',
      documentId: document.id,
      version: document.version,
    };

    await Promise.all([
      this.messageQueue.publish(MESSAGE_ROUTING_KEYS.SEARCH_INDEX, indexMessage),
      this.messageQueue.publish(MESSAGE_ROUTING_KEYS.RAG_REBUILD, pipelineCommand),
      this.messageQueue.publish(MESSAGE_ROUTING_KEYS.KG_REBUILD, pipelineCommand),
    ]);
  }
}
