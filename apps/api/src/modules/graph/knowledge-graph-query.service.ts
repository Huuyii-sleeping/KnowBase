import { Injectable } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { DocumentQueryService } from '../documents/document-query.service';
import { GraphIndexService } from '../pipeline/kg/graph-index.service';
import { SearchGraphDto } from './dto/search-graph.dto';

@Injectable()
export class KnowledgeGraphQueryService {
  constructor(
    private readonly documentQuery: DocumentQueryService,
    private readonly graphIndex: GraphIndexService,
  ) {}

  async search(query: SearchGraphDto, user: AuthUser) {
    const normalizedQuery = query.query.trim();
    const allowedDocumentIds = await this.documentQuery.findVisiblePublishedIds(user);
    const items = await this.graphIndex.searchRelated({
      query: normalizedQuery,
      allowedDocumentIds,
      maxHops: query.maxHops,
      limit: query.limit,
    });

    return {
      query: normalizedQuery,
      maxHops: query.maxHops,
      items,
    };
  }
}
