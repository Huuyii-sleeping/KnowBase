import { Injectable } from '@nestjs/common';
import { RagQueryService } from '../rag/rag-query.service';
import { RerankService } from '../retrieval/rerank/rerank.service';
import {
  hybridCandidateCount,
  mergeChunkCandidates,
} from './hybrid-candidates';
import { HybridSearchDto } from './dto/hybrid-search.dto';
import { AuthUser } from '../auth/auth.types';

export type HybridSearchSource = 'keyword' | 'semantic' | 'graph';

export interface HybridSearchItem {
  documentId: string;
  chunkId?: string;
  chunkIndex?: number;
  title: string;
  content?: string;
  category: string | null;
  team: string | null;
  tags: string[];
  score: number;
  keywordScore: number | null;
  semanticScore: number | null;
  sources: HybridSearchSource[];
  rerankScore: number;
}

export interface HybridSearchResult {
  query: string;
  topK: number;
  items: HybridSearchItem[];
}

@Injectable()
export class HybridSearchService {
  constructor(
    private readonly ragQuery: RagQueryService,
    private readonly rerank: RerankService,
  ) {}

  async search(
    query: HybridSearchDto,
    user?: AuthUser,
  ): Promise<HybridSearchResult> {
    const normalizedQuery = query.query.trim();
    const input = {
      query: normalizedQuery,
      topK: hybridCandidateCount(query.topK),
    };
    const [keywordResult, semanticResult] = await Promise.all([
      this.ragQuery.searchKeywordChunks(input, user),
      this.ragQuery.search(input, user),
    ]);
    const candidates = mergeChunkCandidates(
      keywordResult.items,
      semanticResult.items,
    );
    const reranked = this.rerank.rerank(normalizedQuery, candidates, {
      topK: query.topK,
    });

    return {
      query: normalizedQuery,
      topK: query.topK,
      items: reranked,
    };
  }
}
