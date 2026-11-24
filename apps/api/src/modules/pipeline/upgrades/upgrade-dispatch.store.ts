import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { OutboxStore } from '../../delivery/outbox.store';
import { MESSAGE_ROUTING_KEYS } from '../../message-queue/message-queue.constants';
const ROUTES = {
  search: MESSAGE_ROUTING_KEYS.SEARCH_INDEX,
  rag: MESSAGE_ROUTING_KEYS.RAG_REBUILD,
  kg: MESSAGE_ROUTING_KEYS.KG_REBUILD,
};
@Injectable()
export class UpgradeDispatchStore {
  constructor(
    private readonly source: DataSource,
    private readonly outbox: OutboxStore,
  ) {}
  async dispatch(
    maxInFlight: number,
    matches: (hash: string) => boolean,
  ): Promise<boolean> {
    return this.source.transaction(async (manager) => {
      // One global scheduler lock makes the admission bound valid across worker processes.
      const [{ locked }] = await manager.query(
        `SELECT pg_try_advisory_xact_lock(204816,4) AS locked`,
      );
      if (!locked) return false;
      const [{ count }] =
        await manager.query(`SELECT count(*)::int AS count FROM kh_index_upgrade_task t WHERE
        t.state IN ('dispatched','running') OR (t.state IN ('failed','activation_unknown') AND t.event_id IS NOT NULL AND
        NOT EXISTS(SELECT 1 FROM kh_pipeline_receipt r WHERE r.consumer='knowbase.pipeline.'||t.pipeline AND r.event_id=t.event_id::text AND r.status IN ('DEAD','COMPLETED')))`);
      if (count >= maxInFlight) return false;
      const [plan] =
        await manager.query(`SELECT * FROM kh_index_upgrade_plan WHERE state='running' AND next_dispatch_at<=clock_timestamp()
        ORDER BY next_dispatch_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if (!plan) return false;
      if (!matches(plan.target_hash)) {
        await manager.query(
          `UPDATE kh_index_upgrade_plan SET state='paused' WHERE id=$1`,
          [plan.id],
        );
        return false;
      }
      const [task] = await manager.query(
        `SELECT t.*,i.document_id,i.version,i.content_id FROM kh_index_upgrade_task t
        JOIN kh_index_upgrade_item i ON i.id=t.item_id WHERE i.plan_id=$1 AND t.state='pending' ORDER BY i.id,t.pipeline LIMIT 1 FOR UPDATE OF t`,
        [plan.id],
      );
      if (!task) {
        const [{ count: open }] = await manager.query(
          `SELECT count(*)::int AS count FROM kh_index_upgrade_task t JOIN kh_index_upgrade_item i ON i.id=t.item_id
          WHERE i.plan_id=$1 AND (t.state IN ('dispatched','running') OR (t.state IN ('failed','activation_unknown') AND
          NOT EXISTS(SELECT 1 FROM kh_pipeline_receipt r WHERE r.consumer='knowbase.pipeline.'||t.pipeline AND r.event_id=t.event_id::text AND r.status IN ('DEAD','COMPLETED'))))`,
          [plan.id],
        );
        await manager.query(
          `UPDATE kh_index_upgrade_plan SET state=CASE WHEN $2=0 THEN 'completed' ELSE state END,
          next_dispatch_at=clock_timestamp()+interval '1 second' WHERE id=$1`,
          [plan.id, open],
        );
        return false;
      }
      const [current] = await manager.query(
        `SELECT id FROM kh_document WHERE id=$1 AND version=$2 AND content_id=$3 AND status='PUBLISHED'`,
        [task.document_id, task.version, task.content_id],
      );
      if (!current) {
        await manager.query(
          `UPDATE kh_index_upgrade_task SET state='skipped',error_code='DOCUMENT_CHANGED_OR_DELETED' WHERE id=$1`,
          [task.id],
        );
        return false;
      }
      const token = randomUUID();
      const event = await this.outbox.enqueue(
        manager,
        ROUTES[task.pipeline as keyof typeof ROUTES],
        {
          type: 'DOCUMENT_INDEX_UPGRADE',
          taskId: task.id,
          dispatchId: token,
        },
      );
      await manager.query(
        `UPDATE kh_index_upgrade_task SET state='dispatched',dispatch_id=$2,event_id=$3,updated_at=clock_timestamp() WHERE id=$1`,
        [task.id, token, event],
      );
      // No accumulated credits: a restart cannot produce a catch-up burst.
      await manager.query(
        `UPDATE kh_index_upgrade_plan SET next_dispatch_at=clock_timestamp()+($2*interval '1 millisecond') WHERE id=$1`,
        [plan.id, plan.interval_ms],
      );
      return true;
    });
  }
}
