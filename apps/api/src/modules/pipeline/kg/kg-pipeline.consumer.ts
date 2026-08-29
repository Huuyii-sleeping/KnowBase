import { Injectable } from '@nestjs/common';
import {
  MESSAGE_QUEUE_NAMES,
  MESSAGE_ROUTING_KEYS,
} from '../../message-queue/message-queue.constants';
import { MessageQueueService } from '../../message-queue/message-queue.service';
import type {
  DocumentGraphDeleteMessage,
  DocumentPipelineCommand,
} from '../../message-queue/message-queue.types';
import { KgPipelineService } from './kg-pipeline.service';

@Injectable()
export class KgPipelineConsumer {
  constructor(
    private readonly messageQueue: MessageQueueService,
    private readonly pipeline: KgPipelineService,
  ) {}

  consume(): Promise<void> {
    return this.messageQueue.consume<DocumentPipelineCommand | DocumentGraphDeleteMessage>(
      MESSAGE_QUEUE_NAMES.KG,
      [MESSAGE_ROUTING_KEYS.KG_REBUILD, MESSAGE_ROUTING_KEYS.KG_DELETE],
      (message) => {
        if (message.type === 'DOCUMENT_GRAPH_DELETE') {
          return this.pipeline.deleteDocument(message.documentId);
        }

        return this.pipeline.rebuildDocument(message.documentId, message.version).then(() => undefined);
      },
    );
  }
}
