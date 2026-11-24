import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { UpgradeTask } from './upgrade.types';
@Injectable()
export class UpgradeExecutionStore {
  constructor(private readonly source: DataSource) {}
  async claim(
    id: string,
    token: string,
    pipeline: string,
  ): Promise<UpgradeTask | null> {
    return this.source.transaction(async (manager) => {
      const [task]: UpgradeTask[] = await manager.query(
        `SELECT t.*,i.document_id,i.version,i.content_id,i.plan_id,p.target_hash
        FROM kh_index_upgrade_task t JOIN kh_index_upgrade_item i ON i.id=t.item_id JOIN kh_index_upgrade_plan p ON p.id=i.plan_id
        WHERE t.id=$1 AND t.dispatch_id=$2 AND t.pipeline=$3 FOR UPDATE OF t`,
        [id, token, pipeline],
      );
      if (!task || ['succeeded', 'skipped', 'pending'].includes(task.state))
        return null;
      // The delivery receipt serializes the same event across redelivery/process restart.
      // Never reuse an interrupted generation: its activation may have committed.
      await manager.query(
        `UPDATE kh_index_upgrade_attempt SET state='interrupted',finished_at=clock_timestamp()
        WHERE task_id=$1 AND state='running'`,
        [id],
      );
      const generation = randomUUID();
      await manager.query(
        `INSERT INTO kh_index_upgrade_attempt(generation,task_id,dispatch_id,event_id,state) VALUES($1,$2,$3,$4,'running')`,
        [generation, id, token, task.event_id],
      );
      await manager.query(
        `UPDATE kh_index_upgrade_task SET state='running',generation=$2,error_code=NULL,updated_at=clock_timestamp() WHERE id=$1`,
        [id, generation],
      );
      return { ...task, generation };
    });
  }
  async activated(manager: EntityManager, task: UpgradeTask) {
    const [, affected] = await manager.query(
      `UPDATE kh_index_upgrade_task SET state='succeeded',error_code=NULL,updated_at=clock_timestamp()
      WHERE id=$1 AND dispatch_id=$2 AND generation=$3 AND state='running' RETURNING id`,
      [task.id, task.dispatch_id, task.generation],
    );
    if (affected !== 1) throw new Error('UPGRADE_ATTEMPT_SUPERSEDED');
    await manager.query(
      `UPDATE kh_index_upgrade_attempt SET state='succeeded',finished_at=clock_timestamp() WHERE generation=$1`,
      [task.generation],
    );
  }
  async finish(
    task: UpgradeTask,
    state: 'failed' | 'skipped' | 'activation_unknown',
    code: string,
  ) {
    await this.source.transaction(async (manager) => {
      // A COMMIT error can mean the success transaction committed. Never overwrite it.
      await manager.query(
        `UPDATE kh_index_upgrade_task SET state=$4,error_code=$5,updated_at=clock_timestamp()
        WHERE id=$1 AND dispatch_id=$2 AND generation=$3 AND state='running'`,
        [task.id, task.dispatch_id, task.generation, state, code],
      );
      await manager.query(
        `UPDATE kh_index_upgrade_attempt SET state=$2,error_code=$3,finished_at=clock_timestamp()
        WHERE generation=$1 AND state='running'`,
        [task.generation, state, code],
      );
    });
  }
}
