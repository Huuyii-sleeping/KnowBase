import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RabbitMqConsumerService } from './rabbitmq-consumer.service';

function fixture() {
  let receiver: (message: any) => void;
  const channel = Object.assign(new EventEmitter(), {
    prefetch: vi.fn(),
    ack: vi.fn(),
    consume: vi.fn(async (_queue, handler) => {
      receiver = handler;
    }),
    close: vi.fn(async () => {
      channel.emit('close');
    }),
  });
  const connection = {
    get: vi
      .fn()
      .mockResolvedValue({ createChannel: vi.fn().mockResolvedValue(channel) }),
  };
  const processing = {
    process: vi.fn(async (_queue, delivery, handler) => {
      await handler(JSON.parse(delivery.body));
    }),
  };
  const topology = { declare: vi.fn() };
  const service = new RabbitMqConsumerService(
    { get: (_key: string, fallback: unknown) => fallback } as any,
    connection as any,
    topology as any,
    processing as any,
  );
  const message = {
    content: Buffer.from('{"version":1}'),
    properties: { messageId: 'event-1', headers: {} },
    fields: { routingKey: 'document.index' },
  };
  return {
    service,
    channel,
    connection,
    processing,
    message,
    deliver: (m = message) => receiver(m),
  };
}
afterEach(() => vi.useRealTimers());

describe('RabbitMQ consumer recovery', () => {
  it('acks only after durable settlement completes', async () => {
    const { service, channel, processing, deliver, message } = fixture();
    let commit!: () => void;
    processing.process.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          commit = resolve;
        }),
    );
    await service.subscribe('search', vi.fn());
    deliver();
    expect(channel.ack).not.toHaveBeenCalled();
    commit();
    await vi.waitFor(() => expect(channel.ack).toHaveBeenCalledWith(message));
    await service.onModuleDestroy();
  });
  it('leaves the original unacked and closes the channel on persistence failure', async () => {
    const { service, channel, processing, deliver } = fixture();
    processing.process.mockRejectedValueOnce(new Error('postgres down'));
    await service.subscribe('search', vi.fn());
    deliver();
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalled());
    expect(channel.ack).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });
  it('reconnects automatically when RabbitMQ was unavailable on startup and after channel close', async () => {
    vi.useFakeTimers();
    const { service, channel, connection } = fixture();
    connection.get.mockRejectedValueOnce(new Error('broker unavailable'));
    await service.subscribe('search', vi.fn());
    expect(channel.consume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(channel.consume).toHaveBeenCalledTimes(1);
    channel.emit('close');
    await vi.advanceTimersByTimeAsync(5000);
    expect(channel.consume).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(5000);
    expect(channel.consume).toHaveBeenCalledTimes(2);
  });
  it('uses stable IDs for legacy messages without a messageId', async () => {
    const { service, processing, deliver, message } = fixture();
    message.properties.messageId = '';
    await service.subscribe('search', vi.fn());
    deliver();
    deliver();
    await vi.waitFor(() => expect(processing.process).toHaveBeenCalledTimes(2));
    expect(processing.process.mock.calls[0][1].eventId).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(processing.process.mock.calls[0][1].eventId).toBe(
      processing.process.mock.calls[1][1].eventId,
    );
    await service.onModuleDestroy();
  });
});
