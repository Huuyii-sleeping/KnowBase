import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { MESSAGE_ROUTING_KEYS } from '../message-queue/message-queue.constants';
import { OutboxStore } from '../delivery/outbox.store';
import { DocumentContentStore } from './document-content.store';
import { Document } from './entities/document.entity';

@Injectable()
export class DocumentPipelinePublisher {
  constructor(
    private readonly outbox: OutboxStore,
    private readonly contentStore: DocumentContentStore,
  ) {}

  async publishDocument(
    document: Document,
    manager: EntityManager,
  ): Promise<void> {
    const content = await this.contentStore.findByContentId(document.contentId);
    if (!content)
      throw new Error(`document content not found: ${document.contentId}`);
    const command = {
      type: 'DOCUMENT_PIPELINE_COMMAND',
      documentId: document.id,
      version: document.version,
    };
    // Use the same transaction manager as the document state update. No broker
    // connection is required for a successful publication transaction.
    await this.outbox.enqueue(manager, MESSAGE_ROUTING_KEYS.SEARCH_INDEX, {
      type: 'DOCUMENT_INDEX',
      documentId: document.id,
      version: document.version,
      metadata: document,
      markdown: content.markdown,
    });
    await this.outbox.enqueue(
      manager,
      MESSAGE_ROUTING_KEYS.RAG_REBUILD,
      command,
    );
    await this.outbox.enqueue(
      manager,
      MESSAGE_ROUTING_KEYS.KG_REBUILD,
      command,
    );
  }

  async deleteDocument(
    document: Document,
    manager: EntityManager,
  ): Promise<void> {
    for (const route of [
      MESSAGE_ROUTING_KEYS.SEARCH_DELETE,
      MESSAGE_ROUTING_KEYS.RAG_DELETE,
      MESSAGE_ROUTING_KEYS.KG_DELETE,
    ]) {
      await this.outbox.enqueue(manager, route, {
        type: 'DOCUMENT_INDEX_DELETE',
        documentId: document.id,
      });
    }
    await this.outbox.enqueue(manager, MESSAGE_ROUTING_KEYS.SOURCE_DELETE, {
      type: 'DOCUMENT_SOURCE_DELETE',
      documentId: document.id,
      storageKey: document.storageKey,
    });
  }
}
