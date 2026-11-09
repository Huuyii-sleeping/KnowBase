import { describe, expect, it, vi } from 'vitest';
import { MessageProcessingService } from './message-processing.service';
import type { DeliveryReceipt } from './delivery.types';

function fixture(
  initial: DeliveryReceipt = { status: 'PENDING', attempt: -1 },
) {
  let receipt = { ...initial };
  const tasks: any[] = [];
  const manager = {};
  const receipts = {
    withLock: vi.fn(async (_consumer, _eventId, work) => {
      const previous = { ...receipt };
      const length = tasks.length;
      try {
        await work(manager, receipt);
      } catch (error) {
        receipt = previous;
        tasks.length = length;
        throw error;
      }
    }),
    record: vi.fn(async (_manager, _consumer, _eventId, status, attempt) => {
      receipt = { status, attempt };
    }),
  };
  const outbox = {
    schedule: vi.fn(async (_manager, delivery, delay, error) => {
      tasks.push({ ...delivery, delay, error });
    }),
  };
  const config = { get: vi.fn((_key, fallback) => fallback) };
  const service = new MessageProcessingService(
    config as any,
    receipts as any,
    outbox as any,
  );
  return { service, receipts, outbox, tasks, getReceipt: () => receipt };
}
const delivery = {
  eventId: 'event-1',
  routingKey: 'document.index',
  body: '{"documentId":"doc-1"}',
  attempt: 0,
};

describe('durable consumer settlement', () => {
  it('records completion and suppresses duplicate delivery after a lost ack', async () => {
    const { service, receipts, getReceipt } = fixture();
    const handler = vi.fn();
    await service.process('search', delivery, handler);
    await service.process('search', delivery, handler);
    expect(handler).toHaveBeenCalledExactlyOnceWith({ documentId: 'doc-1' });
    expect(getReceipt()).toEqual({ status: 'COMPLETED', attempt: 0 });
    expect(receipts.record).toHaveBeenCalledOnce();
  });

  it('schedules a durable delayed retry and suppresses the original failed delivery', async () => {
    const { service, tasks, getReceipt } = fixture();
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('ES unavailable'))
      .mockResolvedValue(undefined);
    await service.process('search', delivery, handler);
    await service.process('search', delivery, handler);
    expect(tasks).toEqual([
      { ...delivery, attempt: 1, delay: 5000, error: 'ES unavailable' },
    ]);
    expect(getReceipt()).toEqual({ status: 'RETRY', attempt: 0 });
    await service.process('search', { ...delivery, attempt: 1 }, handler);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(getReceipt().status).toBe('COMPLETED');
  });

  it('uses finite exponential retries then durably dead-letters the original body', async () => {
    const { service, tasks, getReceipt } = fixture();
    const handler = vi.fn().mockRejectedValue(new Error('bad extraction'));
    for (let attempt = 0; attempt < 3; attempt++)
      await service.process('kg', { ...delivery, attempt }, handler);
    expect(tasks.map((t) => [t.routingKey, t.attempt, t.delay])).toEqual([
      ['document.index', 1, 5000],
      ['document.index', 2, 10000],
      ['document.index.dead', 3, 0],
    ]);
    expect(tasks[2].body).toBe(delivery.body);
    expect(getReceipt()).toEqual({ status: 'DEAD', attempt: 2 });
    await service.process('kg', delivery, handler);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it.each(['not-json', 'null', '[]'])(
    'retries malformed JSON without invoking the business handler: %s',
    async (body) => {
      const { service, tasks } = fixture();
      const handler = vi.fn();
      await service.process('search', { ...delivery, body }, handler);
      expect(handler).not.toHaveBeenCalled();
      expect(tasks[0]).toMatchObject({ body, attempt: 1 });
    },
  );

  it('does not settle the original if persisting a retry fails', async () => {
    const { service, outbox, getReceipt } = fixture();
    outbox.schedule.mockRejectedValueOnce(new Error('database down'));
    await expect(
      service.process(
        'search',
        delivery,
        vi.fn().mockRejectedValue(new Error('ES down')),
      ),
    ).rejects.toThrow('database down');
    expect(getReceipt()).toEqual({ status: 'PENDING', attempt: -1 });
  });

  it('rolls back the retry row when recording the receipt fails', async () => {
    const { service, receipts, tasks } = fixture();
    receipts.record.mockRejectedValueOnce(new Error('commit failed'));
    await expect(
      service.process('search', delivery, vi.fn().mockRejectedValue(undefined)),
    ).rejects.toThrow('commit failed');
    expect(tasks).toEqual([]);
  });
});
