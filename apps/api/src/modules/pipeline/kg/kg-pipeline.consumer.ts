import { UpgradeRunnerService } from '../upgrades/upgrade-runner.service';
import { DocumentIndexUpgradeMessage } from '../../message-queue/message-queue.types';
import { Injectable, Optional } from '@nestjs/common';
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
  DocumentAssetsDeleteMessage,
} from '../../message-queue/message-queue.types';
import { KgPipelineService } from './kg-pipeline.service';
import { DocumentSourceCleanupService } from '../../documents/document-source-cleanup.service';
import { DocumentAssetsCleanupService } from '../../documents/document-assets-cleanup.service';

@Injectable()
export class KgPipelineConsumer {
  constructor(
    private readonly messageQueue: MessageQueueService,
    private readonly pipeline: KgPipelineService,
    private readonly cleanup: DocumentSourceCleanupService,
    private readonly assets: DocumentAssetsCleanupService,
    @Optional() private readonly upgrades?: UpgradeRunnerService,
  ) {}

  consume(): Promise<void> {
    return this.messageQueue.consume<
      | DocumentIndexUpgradeMessage
      | DocumentPipelineCommand
      | DocumentGraphDeleteMessage
      | DocumentIndexDeleteMessage
      | DocumentSourceDeleteMessage
      | DocumentAssetsDeleteMessage
    >(
      MESSAGE_QUEUE_NAMES.KG,
      [
        MESSAGE_ROUTING_KEYS.KG_REBUILD,
        MESSAGE_ROUTING_KEYS.KG_DELETE,
        MESSAGE_ROUTING_KEYS.SOURCE_DELETE,
        MESSAGE_ROUTING_KEYS.ASSETS_DELETE,
      ],
      (message) => {
        if (message.type === 'DOCUMENT_INDEX_UPGRADE') {
          if (!this.upgrades) throw new Error('UPGRADE_WORKER_UNAVAILABLE');
          return this.upgrades.run(message, 'kg');
        }
        if (message.type === 'DOCUMENT_ASSETS_DELETE')
          return this.assets.cleanup(message.documentId, message.keys);
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
