import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from '../entities/document.entity';
import { AuthUser } from '../../auth/auth.types';
import { DocumentAccessService } from '../../authorization/document-access.service';
import { IndexBuildProgressStore } from '../../indexing/index-build-progress.store';

@Injectable()
export class DocumentIndexStatusService {
  constructor(
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    private readonly access: DocumentAccessService,
    private readonly builds: IndexBuildProgressStore,
  ) {}
  async read(id: string, user: AuthUser) {
    const document = await this.documents.findOneBy({ id });
    if (!document) throw new NotFoundException('document not found');
    this.access.assertCanView(document, user);
    // Internal attempt progress is for maintainers; readers only need current document availability.
    this.access.assertCanEdit(document, user);
    const attempts = await this.builds.latest(id);
    return {
      documentId: id,
      version: document.version,
      attempts: attempts.map((attempt) => ({
        ...attempt,
        currentVersion: attempt.version === document.version,
      })),
    };
  }
}
