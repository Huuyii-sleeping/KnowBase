import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  UpgradePlan,
  UpgradeSnapshot,
  UpgradeTarget,
  UPGRADE_PIPELINES,
} from './upgrade.types';
@Injectable()
export class UpgradePlanStore {
  constructor(private readonly source: DataSource) {}
  async create(
    createdBy: string,
    target: UpgradeTarget,
    hash: string,
    scope: unknown,
    interval: number,
  ): Promise<string> {
    const id = randomUUID();
    await this.source.query(
      `INSERT INTO kh_index_upgrade_plan(id,created_by,target,target_hash,scope,interval_ms)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [id, createdBy, target, hash, scope, interval],
    );
    return id;
  }
  async add(planId: string, snapshots: UpgradeSnapshot[]) {
    await this.source.transaction(async (manager) => {
      for (const snapshot of snapshots) {
        const id = randomUUID(),
          d = snapshot.document;
        await manager.query(
          `INSERT INTO kh_index_upgrade_item(id,plan_id,document_id,title,version,content_id,classification,previous_strategy)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            planId,
            d.id,
            d.title,
            d.version,
            d.contentId,
            snapshot.classification,
            snapshot.previousStrategy,
          ],
        );
        if (snapshot.classification === 'rebuild')
          for (const pipeline of UPGRADE_PIPELINES)
            await manager.query(
              `INSERT INTO kh_index_upgrade_task(id,item_id,pipeline) VALUES($1,$2,$3)`,
              [randomUUID(), id, pipeline],
            );
      }
    });
  }
  async finishPreview(id: string, ok: boolean) {
    await this.source.query(
      `UPDATE kh_index_upgrade_plan SET state=$2 WHERE id=$1 AND state='preparing'`,
      [id, ok ? 'preview' : 'preview_failed'],
    );
  }
  async get(
    id: string,
    manager: EntityManager = this.source.manager,
  ): Promise<UpgradePlan> {
    const [plan] = await manager.query(
      `SELECT id,state,target,target_hash,interval_ms,scope,created_at FROM kh_index_upgrade_plan WHERE id=$1`,
      [id],
    );
    if (!plan) throw new NotFoundException('UPGRADE_PLAN_NOT_FOUND');
    return plan;
  }
  async list() {
    return this.source.query(
      `SELECT id,state,target_hash,created_at FROM kh_index_upgrade_plan ORDER BY created_at DESC LIMIT 50`,
    );
  }
  async items(id: string, after?: string, limit = 50) {
    await this.get(id);
    return this.source.query(
      `SELECT i.*,COALESCE(jsonb_agg(jsonb_build_object(
      'id',t.id,'pipeline',t.pipeline,'state',t.state,'eventId',t.event_id,'generation',t.generation,'errorCode',t.error_code,
      'active',COALESCE(h.generation=t.generation AND NOT h.deleted AND d.version=i.version AND d.content_id=i.content_id AND d.status='PUBLISHED',FALSE)
      ) ORDER BY t.pipeline) FILTER(WHERE t.id IS NOT NULL),'[]'::jsonb) AS tasks
      FROM (SELECT * FROM kh_index_upgrade_item WHERE plan_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3) i
      LEFT JOIN kh_index_upgrade_task t ON t.item_id=i.id
      LEFT JOIN kh_document d ON d.id=i.document_id
      LEFT JOIN kh_index_head h ON h.document_id=i.document_id AND h.pipeline=t.pipeline
      GROUP BY i.id,i.plan_id,i.document_id,i.title,i.version,i.content_id,i.classification,i.previous_strategy ORDER BY i.id`,
      [id, after ?? null, limit],
    );
  }
  async summary(id: string) {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const plan = await this.get(id, manager);
      // Document counts are derived from all three tasks; partial completion is explicit.
      const counts = await manager.query(
        `SELECT classification,count(*)::int AS count FROM kh_index_upgrade_item WHERE plan_id=$1 GROUP BY classification`,
        [id],
      );
      const states = await manager.query(
        `SELECT state,count(*)::int AS count FROM (
      SELECT i.id,CASE
        WHEN bool_and(t.state='succeeded') THEN 'succeeded'
        WHEN bool_or(t.state='activation_unknown') THEN 'activation_unknown'
        WHEN bool_or(t.state='running') THEN 'running'
        WHEN bool_or(t.state='dispatched') THEN 'dispatched'
        WHEN bool_or(t.state='failed') THEN 'failed'
        WHEN bool_and(t.state='skipped') THEN 'skipped'
        WHEN bool_or(t.state='succeeded') THEN 'partial'
        ELSE 'pending' END AS state
      FROM kh_index_upgrade_item i JOIN kh_index_upgrade_task t ON t.item_id=i.id WHERE i.plan_id=$1 GROUP BY i.id
    ) s GROUP BY state`,
        [id],
      );
      const tasks = await manager.query(
        `SELECT t.pipeline,t.state,count(*)::int AS count FROM kh_index_upgrade_task t
      JOIN kh_index_upgrade_item i ON i.id=t.item_id WHERE i.plan_id=$1 GROUP BY t.pipeline,t.state`,
        [id],
      );
      const [active] = await manager.query(
        `SELECT count(*)::int AS count FROM kh_index_upgrade_item i
      JOIN kh_document d ON d.id=i.document_id AND d.version=i.version AND d.content_id=i.content_id AND d.status='PUBLISHED'
      WHERE i.plan_id=$1 AND i.classification='rebuild' AND 3=(SELECT count(*) FROM kh_index_upgrade_task t
      JOIN kh_index_head h ON h.document_id=i.document_id AND h.pipeline=t.pipeline AND h.generation=t.generation AND NOT h.deleted
      WHERE t.item_id=i.id AND t.state='succeeded')`,
        [id],
      );
      return {
        plan,
        classifications: counts,
        documents: states,
        tasks,
        activeDocuments: active.count,
      };
    });
  }
  async attempts(id: string, taskId: string) {
    await this.get(id);
    return this.source.query(
      `SELECT a.* FROM kh_index_upgrade_attempt a JOIN kh_index_upgrade_task t ON t.id=a.task_id
      JOIN kh_index_upgrade_item i ON i.id=t.item_id WHERE i.plan_id=$1 AND t.id=$2 ORDER BY a.started_at DESC LIMIT 100`,
      [id, taskId],
    );
  }
}
