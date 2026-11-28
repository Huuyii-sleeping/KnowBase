import { UpgradeDispatchStore } from './upgrade-dispatch.store';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { integerOption } from '../../ingestion/numeric-option';
import { UpgradePolicyService } from './upgrade-policy.service';
@Injectable()
export class UpgradeSchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly logger = new Logger(UpgradeSchedulerService.name);
  private readonly maxInFlight: number;
  constructor(
    private readonly dispatches: UpgradeDispatchStore,
    private readonly policy: UpgradePolicyService,
    private readonly config: ConfigService,
  ) {
    this.maxInFlight = integerOption(config, 'INDEX_UPGRADE_MAX_IN_FLIGHT', 6);
  }
  onModuleInit() {
    if (
      !['true', true].includes(
        this.config.get('PIPELINE_WORKERS_ENABLED', true),
      )
    )
      return;
    this.timer = setInterval(() => {
      void this.tick().catch(() =>
        this.logger.warn('Upgrade dispatch failed; retrying next pass.'),
      );
    }, 250);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async tick(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      return await this.dispatches.dispatch(this.maxInFlight, (hash) =>
        this.policy.matches(hash),
      );
    } finally {
      this.busy = false;
    }
  }
}
