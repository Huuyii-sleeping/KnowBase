import { Injectable } from '@nestjs/common';
import {
  MESSAGE_QUEUE_NAMES,
  MESSAGE_ROUTING_KEYS,
} from '../../message-queue/message-queue.constants';
import { MessageQueueService } from '../../message-queue/message-queue.service';
import type {
  DocumentIndexMessage,
  DocumentIndexDeleteMessage,
} from '../../message-queue/message-queue.types';
import { SearchPipelineService } from './search-pipeline.service';

@Injectable()
export class SearchPipelineConsumer {
  constructor(
    private readonly messageQueue: MessageQueueService,
    private readonly pipeline: SearchPipelineService,
  ) {}

  consume(): Promise<void> {
    return this.messageQueue.consume<
      DocumentIndexMessage | DocumentIndexDeleteMessage
    >(
      MESSAGE_QUEUE_NAMES.SEARCH,
      [MESSAGE_ROUTING_KEYS.SEARCH_INDEX, MESSAGE_ROUTING_KEYS.SEARCH_DELETE],
      (message) =>
        message.type === 'DOCUMENT_INDEX_DELETE'
          ? this.pipeline.deleteDocument(message.documentId)
          : this.pipeline.indexDocument(message),
    );
  }
}
