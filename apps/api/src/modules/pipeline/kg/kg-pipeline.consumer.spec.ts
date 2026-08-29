import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_QUEUE_NAMES, MESSAGE_ROUTING_KEYS } from '../../message-queue/message-queue.constants';
import { KgPipelineConsumer } from './kg-pipeline.consumer';

describe('KgPipelineConsumer', () => {
  it('binds rebuild and delete messages to the KG queue', async () => {
    const pipeline = {
      rebuildDocument: vi.fn().mockResolvedValue({ chunks: 1, entities: 1, relations: 0 }),
      deleteDocument: vi.fn().mockResolvedValue(undefined),
    };
    const messageQueue = {
      consume: vi.fn(async (_queue: string, _routingKeys: string[], handler: (message: any) => Promise<void>) => {
        await handler({ type: 'DOCUMENT_GRAPH_DELETE', documentId: 'document-1' });
      }),
    };
    const consumer = new KgPipelineConsumer(messageQueue as any, pipeline as any);

    await consumer.consume();

    expect(messageQueue.consume).toHaveBeenCalledWith(
      MESSAGE_QUEUE_NAMES.KG,
      [MESSAGE_ROUTING_KEYS.KG_REBUILD, MESSAGE_ROUTING_KEYS.KG_DELETE],
      expect.any(Function),
    );
    expect(pipeline.deleteDocument).toHaveBeenCalledWith('document-1');
    expect(pipeline.rebuildDocument).not.toHaveBeenCalled();
  });

  it('dispatches rebuild commands to the KG pipeline', async () => {
    const pipeline = {
      rebuildDocument: vi.fn().mockResolvedValue({ chunks: 1, entities: 1, relations: 0 }),
      deleteDocument: vi.fn().mockResolvedValue(undefined),
    };
    const messageQueue = {
      consume: vi.fn(async (_queue: string, _routingKeys: string[], handler: (message: any) => Promise<void>) => {
        await handler({ type: 'DOCUMENT_PIPELINE_COMMAND', documentId: 'document-1', version: 3 });
      }),
    };
    const consumer = new KgPipelineConsumer(messageQueue as any, pipeline as any);

    await consumer.consume();

    expect(pipeline.rebuildDocument).toHaveBeenCalledWith('document-1', 3);
    expect(pipeline.deleteDocument).not.toHaveBeenCalled();
  });
});
