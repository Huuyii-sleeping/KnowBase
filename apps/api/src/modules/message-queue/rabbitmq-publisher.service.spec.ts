import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RabbitMqPublisherService } from './rabbitmq-publisher.service';

function fixture() {
  const channel = Object.assign(new EventEmitter(), {
    publish: vi.fn(),
    close: vi.fn(async () => {
      channel.emit('close');
    }),
  });
  const connection = {
    get: vi.fn().mockResolvedValue({
      createConfirmChannel: vi.fn().mockResolvedValue(channel),
    }),
  };
  const topology = { declare: vi.fn() };
  const service = new RabbitMqPublisherService(
    { get: (_key: string, fallback: unknown) => fallback } as any,
    connection as any,
    topology as any,
  );
  return { service, channel, connection, topology };
}
const options = { messageId: 'event-1', attempt: 0 };
const body = Buffer.from('{"v":1}');
afterEach(() => vi.useRealTimers());

describe('RabbitMQ confirmed publisher', () => {
  it('waits for confirms even when publish returns true and preserves the event ID', async () => {
    const { service, channel } = fixture();
    channel.publish.mockReturnValue(true);
    let finished = false;
    const work = service.publish('document.index', body, options).then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(channel.publish).toHaveBeenCalled());
    expect(finished).toBe(false);
    const args = channel.publish.mock.calls[0];
    expect(args[3]).toMatchObject({
      mandatory: true,
      persistent: true,
      messageId: 'event-1',
      headers: { 'x-knowbase-attempt': 0 },
    });
    args[4](null);
    await work;
    expect(finished).toBe(true);
  });
  it('treats backpressure as separate from successful delivery', async () => {
    const { service, channel } = fixture();
    channel.publish.mockImplementation((_e, _r, _b, _o, confirm) => {
      confirm(null);
      return false;
    });
    await expect(
      service.publish('document.index', body, options),
    ).resolves.toBeUndefined();
  });
  it('rejects mandatory returns even if the broker then confirms', async () => {
    const { service, channel } = fixture();
    channel.publish.mockImplementation(
      (_e, routingKey, _b, properties, confirm) => {
        channel.emit('return', { properties, fields: { routingKey } });
        confirm(null);
      },
    );
    await expect(service.publish('missing', body, options)).rejects.toThrow(
      'unroutable',
    );
  });
  it('rejects broker nacks', async () => {
    const { service, channel } = fixture();
    channel.publish.mockImplementation((_e, _r, _b, _o, confirm) =>
      confirm(new Error('nack')),
    );
    await expect(
      service.publish('document.index', body, options),
    ).rejects.toThrow('nack');
  });
  it('rejects unconfirmed sends when the channel closes and recreates the channel', async () => {
    const { service, channel, connection } = fixture();
    const first = service.publish('document.index', body, options);
    const failed = expect(first).rejects.toThrow('channel closed');
    await vi.waitFor(() => expect(channel.publish).toHaveBeenCalled());
    channel.emit('close');
    await failed;
    channel.publish.mockImplementation((_e, _r, _b, _o, confirm) =>
      confirm(null),
    );
    await service.publish('document.index', body, options);
    expect(connection.get).toHaveBeenCalledTimes(2);
  });
  it('times out missing confirms so relay transactions do not stay locked forever', async () => {
    vi.useFakeTimers();
    const { service, channel } = fixture();
    const work = service.publish('document.index', body, options);
    const failure = expect(work).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10001);
    await failure;
    expect(channel.close).toHaveBeenCalled();
  });
});
