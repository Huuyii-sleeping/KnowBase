import { Injectable, Optional } from '@nestjs/common';
import { OrphanAssetCleanupService } from './orphan-asset-cleanup.service';
import { ParseTaskCleanupStore } from './parse-task-cleanup.store';
import { ParseTaskStore } from './parse-task.store';
import { DocumentContentStore } from '../document-content.store';
import { DocumentAssetsCleanupService } from '../document-assets-cleanup.service';
import { MineruParser } from '../parsing/mineru/mineru.parser';

@Injectable()
export class ParseMaintenanceService {
  constructor(
    private readonly tasks: ParseTaskStore,
    private readonly content: DocumentContentStore,
    private readonly assets: DocumentAssetsCleanupService,
    private readonly mineru: MineruParser,
    private readonly cleanup: ParseTaskCleanupStore,
    @Optional() private readonly orphanAssets?: OrphanAssetCleanupService,
  ) {}

  async run(): Promise<void> {
    await this.tasks.recover();
    for (const task of await this.cleanup.remoteCancellations(
      this.tasks.fingerprint,
    )) {
      await this.mineru.cancel(task.remote_task_id);
      await this.cleanup.remoteCanceled(task.id);
    }
    // Only attempt-owned UUIDs can be collected. Original/historical user content
    // and complete index generations remain outside this maintenance boundary.
    for (const orphan of await this.cleanup.orphanContents()) {
      const body = await this.content.findByContentId(orphan.content_id);
      if (body) {
        await this.assets.cleanup(
          orphan.document_id,
          body.assets.map((asset) => asset.objectKey),
        );
        await this.content.deleteByContentId(orphan.content_id);
      }
      await this.cleanup.forgetContent(orphan.document_id, orphan.content_id);
    }
    await this.orphanAssets?.run();
  }
}
