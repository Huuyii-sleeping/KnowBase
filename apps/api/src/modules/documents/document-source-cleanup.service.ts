import { Injectable } from '@nestjs/common';
import { DocumentContentStore } from './document-content.store';
import { StorageService } from '../storage/storage.service';
import { IndexGenerationStore } from '../indexing/index-generation.store';

@Injectable()
export class DocumentSourceCleanupService {
  constructor(
    private readonly content: DocumentContentStore,
    private readonly storage: StorageService,
    private readonly generations: IndexGenerationStore,
  ) {}

  async cleanup(documentId: string, storageKey: string): Promise<void> {
    if (!(await this.generations.isDeleted(documentId, 'kg'))) return;
    await this.content.deleteByDocumentId(documentId);
    await this.storage.removeObject(storageKey);
  }
}
