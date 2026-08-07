import { Injectable } from '@nestjs/common';
import {
  MESSAGE_QUEUE_NAMES,
  MESSAGE_ROUTING_KEYS,
} from '../../message-queue/message-queue.constants';
import { MessageQueueService } from '../../message-queue/message-queue.service';
import type { DocumentIndexMessage } from '../../message-queue/message-queue.types';
import { SearchPipelineService } from './search-pipeline.service';

@Injectable()
export class SearchPipelineConsumer {
  constructor(
    private readonly messageQueue: MessageQueueService,
    private readonly pipeline: SearchPipelineService,
  ) {}

  consume(): Promise<void> {
    return this.messageQueue.consume<DocumentIndexMessage>(
      MESSAGE_QUEUE_NAMES.SEARCH,
      MESSAGE_ROUTING_KEYS.SEARCH_INDEX,
      (message) => this.pipeline.indexDocument(message),
    );
  }
}
