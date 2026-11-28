import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '../../auth/auth.types';
import { UserRole } from '../../users/entities/user.entity';
import { UpgradePlanStore } from './upgrade-plan.store';
import { UpgradePreviewService, UpgradeScope } from './upgrade-preview.service';
import {
  UpgradeAction,
  UpgradeCommandService,
} from './upgrade-command.service';
@Injectable()
export class UpgradeManagementService {
  constructor(
    private readonly plans: UpgradePlanStore,
    private readonly previews: UpgradePreviewService,
    private readonly commands: UpgradeCommandService,
  ) {}
  private authorize(user: AuthUser) {
    if (user.role !== UserRole.ADMIN)
      throw new ForbiddenException('UPGRADE_ADMIN_REQUIRED');
  }
  create(user: AuthUser, scope: UpgradeScope) {
    this.authorize(user);
    return this.previews.create(user.id, scope);
  }
  list(user: AuthUser) {
    this.authorize(user);
    return this.plans.list();
  }
  summary(user: AuthUser, id: string) {
    this.authorize(user);
    return this.plans.summary(id);
  }
  items(user: AuthUser, id: string, after?: string, limit = 50) {
    this.authorize(user);
    return this.plans.items(id, after, limit);
  }
  attempts(user: AuthUser, id: string, taskId: string) {
    this.authorize(user);
    return this.plans.attempts(id, taskId);
  }
  async command(
    user: AuthUser,
    id: string,
    action: UpgradeAction,
    taskId?: string,
  ) {
    this.authorize(user);
    await this.commands.apply(id, action, taskId);
    return { accepted: true, planId: id };
  }
}
