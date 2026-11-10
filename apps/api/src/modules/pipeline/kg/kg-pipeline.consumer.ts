import { Injectable } from '@nestjs/common';
import {
  MESSAGE_QUEUE_NAMES,
  MESSAGE_ROUTING_KEYS,
} from '../../message-queue/message-queue.constants';
import { MessageQueueService } from '../../message-queue/message-queue.service';
import type {
  DocumentGraphDeleteMessage,
  DocumentPipelineCommand,
  DocumentIndexDeleteMessage,
  DocumentSourceDeleteMessage,
} from '../../message-queue/message-queue.types';
import { KgPipelineService } from './kg-pipeline.service';
import { DocumentSourceCleanupService } from '../../documents/document-source-cleanup.service';

@Injectable()
export class KgPipelineConsumer {
  constructor(
    private readonly messageQueue: MessageQueueService,
    private readonly pipeline: KgPipelineService,
    private readonly cleanup: DocumentSourceCleanupService,
  ) {}

  consume(): Promise<void> {
    return this.messageQueue.consume<
      | DocumentPipelineCommand
      | DocumentGraphDeleteMessage
      | DocumentIndexDeleteMessage
      | DocumentSourceDeleteMessage
    >(
      MESSAGE_QUEUE_NAMES.KG,
      [
        MESSAGE_ROUTING_KEYS.KG_REBUILD,
        MESSAGE_ROUTING_KEYS.KG_DELETE,
        MESSAGE_ROUTING_KEYS.SOURCE_DELETE,
      ],
      (message) => {
        if (message.type === 'DOCUMENT_SOURCE_DELETE') {
          return this.cleanup.cleanup(message.documentId, message.storageKey);
        }
        if (
          message.type === 'DOCUMENT_GRAPH_DELETE' ||
          message.type === 'DOCUMENT_INDEX_DELETE'
        ) {
          return this.pipeline.deleteDocument(message.documentId);
        }

        return this.pipeline
          .rebuildDocument(message.documentId, message.version)
          .then(() => undefined);
      },
    );
  }
}
