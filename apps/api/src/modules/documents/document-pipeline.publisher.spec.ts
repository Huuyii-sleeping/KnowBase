import { describe, expect, it, vi } from 'vitest';
import { DocumentPipelinePublisher } from './document-pipeline.publisher';
import { MESSAGE_ROUTING_KEYS } from '../message-queue/message-queue.constants';

describe('DocumentPipelinePublisher', () => {
  it('publishes search, RAG and KG messages for the same document version', async () => {
    const messageQueue = { publish: vi.fn().mockResolvedValue(undefined) };
    const documentQuery = {
      findOne: vi.fn().mockResolvedValue({
        id: 'document-1',
        contentId: 'content-1',
        version: 2,
        title: 'Knowledge',
      }),
    };
    const contentStore = {
      findByContentId: vi.fn().mockResolvedValue({ markdown: '# Content' }),
    };
    const service = new DocumentPipelinePublisher(
      messageQueue as any,
      documentQuery as any,
      contentStore as any,
    );

    await service.publishDocument('document-1');

    expect(messageQueue.publish).toHaveBeenCalledTimes(3);
    expect(messageQueue.publish).toHaveBeenNthCalledWith(
      1,
      MESSAGE_ROUTING_KEYS.SEARCH_INDEX,
      expect.objectContaining({
        documentId: 'document-1',
        version: 2,
        markdown: '# Content',
      }),
    );
    expect(messageQueue.publish).toHaveBeenNthCalledWith(
      2,
      MESSAGE_ROUTING_KEYS.RAG_REBUILD,
      expect.objectContaining({ documentId: 'document-1', version: 2 }),
    );
    expect(messageQueue.publish).toHaveBeenNthCalledWith(
      3,
      MESSAGE_ROUTING_KEYS.KG_REBUILD,
      expect.objectContaining({ documentId: 'document-1', version: 2 }),
    );
  });
});
