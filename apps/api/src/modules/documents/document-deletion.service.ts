import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Document } from './entities/document.entity';
import { AuthUser } from '../auth/auth.types';
import { DocumentAccessService } from '../authorization/document-access.service';
import { IndexGenerationStore } from '../indexing/index-generation.store';
import { DocumentPipelinePublisher } from './document-pipeline.publisher';

@Injectable()
export class DocumentDeletionService {
  constructor(
    private readonly source: DataSource,
    private readonly access: DocumentAccessService,
    private readonly generations: IndexGenerationStore,
    private readonly publisher: DocumentPipelinePublisher,
  ) {}

  async remove(id: string, user?: AuthUser): Promise<void> {
    await this.source.transaction(async (manager) => {
      const document = await manager.findOne(Document, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!document) throw new NotFoundException('document not found');
      if (user) this.access.assertCanEdit(document, user);
      await this.generations.tombstone(manager, id, document.version);
      await this.publisher.deleteDocument(document, manager);
      await manager.delete(Document, id);
    });
  }
}
