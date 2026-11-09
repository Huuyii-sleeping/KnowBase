import { describe, expect, it, vi } from 'vitest';
import { RabbitMqTopologyService } from './rabbitmq-topology.service';

describe('RabbitMQ topology', () => {
  it('declares routes and dead-letter queues before any publisher sends', async () => {
    const channel = {
      assertExchange: vi.fn(),
      assertQueue: vi.fn(),
      bindQueue: vi.fn(),
    };
    await new RabbitMqTopologyService().declare(channel as any);
    expect(channel.assertQueue).toHaveBeenCalledTimes(6);
    expect(channel.assertQueue).toHaveBeenCalledWith(
      'knowbase.pipeline.search',
      { durable: true },
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'knowbase.pipeline.kg',
      'knowbase.pipeline',
      'document.kg.delete',
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'knowbase.pipeline.kg.dead',
      'knowbase.pipeline',
      'document.kg.delete.dead',
    );
  });
});
