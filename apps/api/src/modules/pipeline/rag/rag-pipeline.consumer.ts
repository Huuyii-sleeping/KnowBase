import { UpgradeRunnerService } from '../upgrades/upgrade-runner.service';
import { DocumentIndexUpgradeMessage } from '../../message-queue/message-queue.types';
import { Injectable, Optional } from '@nestjs/common';
import {
  MESSAGE_QUEUE_NAMES,
  MESSAGE_ROUTING_KEYS,
} from '../../message-queue/message-queue.constants';
import { MessageQueueService } from '../../message-queue/message-queue.service';
import type {
  DocumentPipelineCommand,
  DocumentIndexDeleteMessage,
} from '../../message-queue/message-queue.types';
import { RagPipelineService } from './rag-pipeline.service';

@Injectable()
export class RagPipelineConsumer {
  constructor(
    private readonly messageQueue: MessageQueueService,
    private readonly pipeline: RagPipelineService,
    @Optional() private readonly upgrades?: UpgradeRunnerService,
  ) {}

  consume(): Promise<void> {
    return this.messageQueue.consume<
      | DocumentIndexUpgradeMessage
      | DocumentPipelineCommand
      | DocumentIndexDeleteMessage
    >(
      MESSAGE_QUEUE_NAMES.RAG,
      [MESSAGE_ROUTING_KEYS.RAG_REBUILD, MESSAGE_ROUTING_KEYS.RAG_DELETE],
      (message) =>
        message.type === 'DOCUMENT_INDEX_UPGRADE'
          ? this.upgrades
            ? this.upgrades.run(message, 'rag')
            : Promise.reject(new Error('UPGRADE_WORKER_UNAVAILABLE'))
          : message.type === 'DOCUMENT_INDEX_DELETE'
            ? this.pipeline.deleteDocument(message.documentId)
            : this.pipeline
                .rebuildDocument(message.documentId, message.version)
                .then(() => undefined),
    );
  }
}
