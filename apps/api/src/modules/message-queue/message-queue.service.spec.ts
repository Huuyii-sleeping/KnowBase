import { describe, expect, it, vi } from 'vitest';
import { MessageQueueService } from './message-queue.service';

describe('MessageQueueService transport facade', () => {
  it('preserves outbox event identity and raw bytes without reserializing', async () => {
    const publisher = { publish: vi.fn() };
    const service = new MessageQueueService(publisher as any, {} as any);
    const raw = '{ "version": 2 }';
    const options = { messageId: 'event-1', attempt: 2 };
    await service.publishRaw('document.index', raw, options);
    expect(publisher.publish).toHaveBeenCalledWith(
      'document.index',
      Buffer.from(raw),
      options,
    );
  });
  it('propagates failed confirms to the durable relay', async () => {
    const publisher = {
      publish: vi.fn().mockRejectedValue(new Error('confirm failed')),
    };
    const service = new MessageQueueService(publisher as any, {} as any);
    await expect(
      service.publishRaw('document.index', '{}', {
        messageId: 'event',
        attempt: 0,
      }),
    ).rejects.toThrow('confirm failed');
  });
});
