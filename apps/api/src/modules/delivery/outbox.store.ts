import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { IncomingDelivery, OutboxMessage } from './delivery.types';

@Injectable()
export class OutboxStore {
  constructor(private readonly dataSource: DataSource) {}

  async enqueue(
    manager: EntityManager,
    routingKey: string,
    payload: unknown,
  ): Promise<string> {
    const eventId = randomUUID();
    await this.schedule(manager, {
      eventId,
      routingKey,
      body: JSON.stringify(payload),
      attempt: 0,
    });
    return eventId;
  }

  async schedule(
    manager: EntityManager,
    delivery: IncomingDelivery,
    delayMs = 0,
    error?: string,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO kh_pipeline_outbox (id, event_id, routing_key, body, attempt, available_at, last_error)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp() + $6 * INTERVAL '1 millisecond', $7)
       ON CONFLICT (event_id, attempt) DO NOTHING`,
      [
        randomUUID(),
        delivery.eventId,
        delivery.routingKey,
        delivery.body,
        delivery.attempt,
        delayMs,
        error?.slice(0, 2000) ?? null,
      ],
    );
  }

  async enqueueStandalone(routingKey: string, payload: unknown): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.enqueue(manager, routingKey, payload);
    });
  }

  // Keep the lock until broker confirmation and the sent marker commit together.
  // A crash between those operations intentionally permits duplicate delivery.
  async dispatchOne(
    send: (message: OutboxMessage) => Promise<void>,
    delayFor: (attempt: number) => number,
  ): Promise<'empty' | 'sent' | 'retry'> {
    return this.dataSource.transaction(async (manager) => {
      const [message]: OutboxMessage[] = await manager.query(
        `SELECT * FROM kh_pipeline_outbox
         WHERE published_at IS NULL AND available_at <= clock_timestamp()
         ORDER BY available_at, created_at, id
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!message) return 'empty';
      try {
        await send(message);
      } catch (error) {
        await manager.query(
          `UPDATE kh_pipeline_outbox SET publish_attempts = publish_attempts + 1,
           last_error = $2, available_at = clock_timestamp() + $3 * INTERVAL '1 millisecond' WHERE id = $1`,
          [
            message.id,
            String(error instanceof Error ? error.message : error).slice(
              0,
              2000,
            ),
            delayFor(message.publish_attempts + 1),
          ],
        );
        return 'retry';
      }
      await manager.query(
        'UPDATE kh_pipeline_outbox SET published_at = clock_timestamp(), publish_attempts = publish_attempts + 1, last_error = NULL WHERE id = $1',
        [message.id],
      );
      return 'sent';
    });
  }
}
