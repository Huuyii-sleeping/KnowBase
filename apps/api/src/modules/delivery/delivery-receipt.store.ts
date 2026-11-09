import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DeliveryReceipt } from './delivery.types';

@Injectable()
export class DeliveryReceiptStore {
  constructor(private readonly dataSource: DataSource) {}

  async withLock(
    consumer: string,
    eventId: string,
    work: (manager: EntityManager, receipt: DeliveryReceipt) => Promise<void>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO kh_pipeline_receipt (consumer, event_id, status, attempt)
         VALUES ($1, $2, 'PENDING', -1) ON CONFLICT DO NOTHING`,
        [consumer, eventId],
      );
      const [receipt]: DeliveryReceipt[] = await manager.query(
        'SELECT status, attempt FROM kh_pipeline_receipt WHERE consumer = $1 AND event_id = $2 FOR UPDATE',
        [consumer, eventId],
      );
      await work(manager, receipt);
    });
  }

  async record(
    manager: EntityManager,
    consumer: string,
    eventId: string,
    status: DeliveryReceipt['status'],
    attempt: number,
    error?: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE kh_pipeline_receipt SET status = $3, attempt = $4, last_error = $5, updated_at = clock_timestamp()
       WHERE consumer = $1 AND event_id = $2`,
      [consumer, eventId, status, attempt, error?.slice(0, 2000) ?? null],
    );
  }
}
