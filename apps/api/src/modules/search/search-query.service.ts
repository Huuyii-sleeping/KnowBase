import { Injectable } from '@nestjs/common';
import {
  DocumentSearchResult,
  VectorIndexService,
} from '../pipeline/vector-index/vector-index.service';
import { SearchDocumentsDto } from './dto/search-documents.dto';

@Injectable()
export class SearchQueryService {
  constructor(private readonly vectorIndex: VectorIndexService) {}

  searchDocuments(query: SearchDocumentsDto): Promise<DocumentSearchResult> {
    return this.vectorIndex.searchDocuments({
      keyword: this.clean(query.keyword),
      category: this.clean(query.category),
      team: this.clean(query.team),
      tag: this.clean(query.tag),
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  private clean(value?: string): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
  }
}
