import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class DocumentAssetsCleanupService {
  constructor(private readonly storage: StorageService) {}

  async cleanup(documentId: string, keys: string[]): Promise<void> {
    if (
      !/^[a-z0-9_-]+$/i.test(documentId) ||
      !Array.isArray(keys) ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !key.startsWith(`assets/${documentId}/`) ||
          /(?:^|\/)\.\.(?:\/|$)/.test(key),
      )
    ) {
      throw new Error('Invalid document asset cleanup scope');
    }
    // Failed parser attempts use unique object keys; this never removes adopted assets.
    for (const key of new Set(keys)) await this.storage.removeObject(key);
  }
}
