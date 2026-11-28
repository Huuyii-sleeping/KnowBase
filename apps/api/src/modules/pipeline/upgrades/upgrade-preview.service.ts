import { Injectable } from '@nestjs/common';
import { UpgradeScanStore } from './upgrade-scan.store';
import {
  Document,
  DocumentStatus,
} from '../../documents/entities/document.entity';
import { DocumentContentStore } from '../../documents/document-content.store';
import { UpgradePlanStore } from './upgrade-plan.store';
import { UpgradePolicyService } from './upgrade-policy.service';
import { UpgradeClassification, UpgradeSnapshot } from './upgrade.types';
export interface UpgradeScope {
  documentIds?: string[];
  status?: DocumentStatus;
  intervalMs?: number;
}
export function classifyUpgrade(
  document: Document,
  body: { markdown?: string } | null,
): UpgradeClassification {
  if (document.status !== DocumentStatus.PUBLISHED) return 'unpublished';
  if (!body) return 'missing_content';
  if (document.parseStatus !== 'READY' || !body.markdown?.trim())
    return 'needs_reparse';
  return 'rebuild';
}
@Injectable()
export class UpgradePreviewService {
  constructor(
    private readonly scan: UpgradeScanStore,
    private readonly content: DocumentContentStore,
    private readonly plans: UpgradePlanStore,
    private readonly policy: UpgradePolicyService,
  ) {}
  async create(userId: string, scope: UpgradeScope) {
    const { target, hash } = this.policy.snapshot();
    const id = await this.plans.create(
      userId,
      target,
      hash,
      scope,
      scope.intervalMs ?? 1000,
    );
    // Fix an upper bound and scan metadata by keyset. At most one body is held at a time.
    const boundary = await this.scan.boundary();
    let cursor: string | null = null;
    try {
      for (;;) {
        const documents = await this.scan.page(boundary, cursor, scope);
        if (!documents.length) break;
        const snapshots: UpgradeSnapshot[] = [];
        for (const document of documents) {
          const body =
            document.status === DocumentStatus.PUBLISHED
              ? await this.content.findByContentId(document.contentId)
              : null;
          const previousStrategy = await this.scan.previousStrategy(document);
          snapshots.push({
            document,
            classification: classifyUpgrade(document, body),
            previousStrategy,
          });
        }
        await this.plans.add(id, snapshots);
        cursor = documents.at(-1)!.id;
      }
      await this.plans.finishPreview(id, true);
    } catch (error) {
      await this.plans.finishPreview(id, false);
      throw error;
    }
    return this.plans.summary(id);
  }
}
