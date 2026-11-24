import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UpgradePolicyService } from './upgrade-policy.service';
export type UpgradeAction = 'start' | 'pause' | 'resume' | 'cancel' | 'retry';
@Injectable()
export class UpgradeCommandService {
  constructor(
    private readonly source: DataSource,
    private readonly policy: UpgradePolicyService,
  ) {}
  async apply(id: string, action: UpgradeAction, taskId?: string) {
    await this.source.transaction(async (manager) => {
      const [plan] = await manager.query(
        `SELECT * FROM kh_index_upgrade_plan WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!plan) throw new NotFoundException('UPGRADE_PLAN_NOT_FOUND');
      if (
        ['start', 'resume', 'retry'].includes(action) &&
        !this.policy.matches(plan.target_hash)
      )
        throw new ConflictException('UPGRADE_CONFIG_MISMATCH');
      const allowed: Record<UpgradeAction, string[]> = {
        start: ['preview', 'running'],
        resume: ['paused', 'running'],
        pause: ['running', 'paused'],
        cancel: ['preview', 'running', 'paused', 'completed', 'cancelled'],
        retry: ['running', 'paused', 'completed'],
      };
      if (!allowed[action].includes(plan.state))
        throw new ConflictException('UPGRADE_INVALID_TRANSITION');
      if (taskId) {
        const [item] = await manager.query(
          `SELECT t.id FROM kh_index_upgrade_task t JOIN kh_index_upgrade_item i ON i.id=t.item_id WHERE t.id=$1 AND i.plan_id=$2`,
          [taskId, id],
        );
        if (!item) throw new NotFoundException('UPGRADE_TASK_NOT_FOUND');
      }
      if (action === 'retry') {
        // A new dispatch token fences delayed deliveries from the previous manual round.
        await manager.query(
          `UPDATE kh_index_upgrade_task t SET state='pending',dispatch_id=NULL,event_id=NULL,error_code=NULL
          FROM kh_index_upgrade_item i WHERE t.item_id=i.id AND i.plan_id=$1 AND t.state IN ('failed','activation_unknown') AND ($2::uuid IS NULL OR t.id=$2)`,
          [id, taskId ?? null],
        );
      }
      if (action === 'cancel')
        await manager.query(
          `UPDATE kh_index_upgrade_task t SET state='skipped',error_code='CANCELLED'
        FROM kh_index_upgrade_item i WHERE t.item_id=i.id AND i.plan_id=$1 AND t.state='pending'`,
          [id],
        );
      const state =
        action === 'pause' || (action === 'retry' && plan.state === 'paused')
          ? 'paused'
          : action === 'cancel'
            ? 'cancelled'
            : 'running';
      await manager.query(
        `UPDATE kh_index_upgrade_plan SET state=$2 WHERE id=$1`,
        [id, state],
      );
    });
  }
}
