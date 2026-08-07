import { Injectable } from '@nestjs/common';
import {
  MESSAGE_QUEUE_NAMES,
  MESSAGE_ROUTING_KEYS,
} from '../../message-queue/message-queue.constants';
import { MessageQueueService } from '../../message-queue/message-queue.service';
import type { DocumentPipelineCommand } from '../../message-queue/message-queue.types';
import { RagPipelineService } from './rag-pipeline.service';

@Injectable()
export class RagPipelineConsumer {
  constructor(
    private readonly messageQueue: MessageQueueService,
    private readonly pipeline: RagPipelineService,
  ) {}

  consume(): Promise<void> {
    return this.messageQueue.consume<DocumentPipelineCommand>(
      MESSAGE_QUEUE_NAMES.RAG,
      MESSAGE_ROUTING_KEYS.RAG_REBUILD,
      (message) => this.pipeline.rebuildDocument(message.documentId).then(() => undefined),
    );
  }
}
