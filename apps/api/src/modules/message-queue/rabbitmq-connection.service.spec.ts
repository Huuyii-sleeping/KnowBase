import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ connect }));
import { RabbitMqConnectionService } from './rabbitmq-connection.service';

describe('RabbitMQ connection lifecycle', () => {
  it('shares concurrent opens, then replaces a closed connection', async () => {
    const connection = Object.assign(new EventEmitter(), {
      close: vi.fn().mockResolvedValue(undefined),
    });
    connect.mockReset().mockResolvedValue(connection);
    const service = new RabbitMqConnectionService({
      get: (_key: string, fallback: unknown) => fallback,
    } as any);
    const [one, two] = await Promise.all([service.get(), service.get()]);
    expect(one).toBe(two);
    expect(connect).toHaveBeenCalledTimes(1);
    connection.emit('error', new Error('connection reset'));
    connection.emit('close');
    await service.get();
    expect(connect).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
    await expect(service.get()).rejects.toThrow('shutting down');
  });
  it('allows recovery after a failed initial connection', async () => {
    const connection = Object.assign(new EventEmitter(), {
      close: vi.fn().mockResolvedValue(undefined),
    });
    connect
      .mockReset()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(connection);
    const service = new RabbitMqConnectionService({
      get: (_key: string, fallback: unknown) => fallback,
    } as any);
    await expect(service.get()).rejects.toThrow('offline');
    await expect(service.get()).resolves.toBe(connection);
    await service.onModuleDestroy();
  });
});
