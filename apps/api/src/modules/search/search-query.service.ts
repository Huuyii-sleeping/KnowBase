import { Injectable, Optional } from '@nestjs/common';
import {
  DocumentSearchResult,
  VectorIndexService,
} from '../pipeline/vector-index/vector-index.service';
import { SearchDocumentsDto } from './dto/search-documents.dto';
import { AuthUser } from '../auth/auth.types';
import { DocumentQueryService } from '../documents/document-query.service';

@Injectable()
export class SearchQueryService {
  constructor(
    private readonly vectorIndex: VectorIndexService,
    @Optional() private readonly documentQuery?: DocumentQueryService,
  ) {}

  async searchDocuments(query: SearchDocumentsDto, user?: AuthUser): Promise<DocumentSearchResult> {
    const allowedDocumentIds = user
      ? await this.documentQuery?.findVisiblePublishedIds(user) ?? []
      : undefined;
    return this.vectorIndex.searchDocuments({
      keyword: this.clean(query.keyword),
      category: this.clean(query.category),
      team: this.clean(query.team),
      tag: this.clean(query.tag),
      page: query.page,
      pageSize: query.pageSize,
      allowedDocumentIds,
    });
  }

  private clean(value?: string): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
  }
}
