import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StorageService } from '../../storage/storage.service';
import { DocumentContentStore } from '../document-content.store';

@Injectable()
export class OrphanAssetCleanupService {
  private cursor?: string;
  constructor(
    private readonly storage: StorageService,
    private readonly content: DocumentContentStore,
    private readonly source: DataSource,
  ) {}
  async run() {
    const candidates = await this.storage.orphanCandidates(this.cursor);
    if (!candidates.length) this.cursor = undefined;
    for (const asset of candidates) {
      this.cursor = asset.objectKey;
      const [protectedWork] = await this.source.query(
        `SELECT 1 FROM kh_document_parse_task WHERE document_id=$1 AND state IN ('queued','running','needs_review') LIMIT 1`,
        [asset.documentId],
      );
      if (
        protectedWork ||
        (await this.content.referencesAsset(asset.objectKey))
      )
        continue;
      await this.storage.removeObject(asset.objectKey);
    }
  }
}
