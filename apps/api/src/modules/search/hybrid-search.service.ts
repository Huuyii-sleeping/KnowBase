import { Injectable } from '@nestjs/common';
import { RagQueryService, SemanticSearchItem } from '../rag/rag-query.service';
import { SearchQueryService } from './search-query.service';
import { HybridSearchDto } from './dto/hybrid-search.dto';

export type HybridSearchSource = 'keyword' | 'semantic';

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
}

export interface HybridSearchResult {
  query: string;
  topK: number;
  items: HybridSearchItem[];
}

interface Candidate extends Omit<HybridSearchItem, 'score'> {
  score: number;
}

@Injectable()
export class HybridSearchService {
  constructor(
    private readonly searchQuery: SearchQueryService,
    private readonly ragQuery: RagQueryService,
  ) {}

  async search(query: HybridSearchDto): Promise<HybridSearchResult> {
    const normalizedQuery = query.query.trim();
    const [keywordResult, semanticResult] = await Promise.all([
      this.searchQuery.searchDocuments({
        keyword: normalizedQuery,
        page: 1,
        pageSize: query.topK,
      }),
      this.ragQuery.search({ query: normalizedQuery, topK: query.topK }),
    ]);
    const candidates = this.mergeResults(keywordResult.items, semanticResult.items);

    return {
      query: normalizedQuery,
      topK: query.topK,
      items: candidates
        .sort((left, right) => right.score - left.score)
        .slice(0, query.topK),
    };
  }

  private mergeResults(
    keywordItems: Awaited<ReturnType<SearchQueryService['searchDocuments']>>['items'],
    semanticItems: SemanticSearchItem[],
  ): Candidate[] {
    const maxKeywordScore = this.maxScore(keywordItems.map((item) => item.score ?? 0));
    const maxSemanticScore = this.maxScore(semanticItems.map((item) => item.score ?? 0));
    const keywordByDocument = new Map(
      keywordItems.map((item) => [item.id, item.score ?? 0]),
    );
    const semanticDocumentIds = new Set(semanticItems.map((item) => item.documentId));
    const candidates: Candidate[] = semanticItems.map((item) => ({
      ...this.fromSemantic(item),
      keywordScore: keywordByDocument.get(item.documentId) ?? null,
      sources: keywordByDocument.has(item.documentId)
        ? ['semantic', 'keyword']
        : ['semantic'],
      score: this.blendedScore(
        keywordByDocument.get(item.documentId),
        item.score,
        maxKeywordScore,
        maxSemanticScore,
      ),
    }));

    for (const item of keywordItems) {
      if (semanticDocumentIds.has(item.id)) {
        continue;
      }
      candidates.push({
        documentId: item.id,
        title: item.title,
        category: item.category ?? null,
        team: item.team ?? null,
        tags: item.tags ?? [],
        score: this.blendedScore(item.score, undefined, maxKeywordScore, maxSemanticScore),
        keywordScore: item.score,
        semanticScore: null,
        sources: ['keyword'],
      });
    }

    return candidates;
  }

  private fromSemantic(item: SemanticSearchItem): Candidate {
    return {
      documentId: item.documentId,
      chunkId: item.chunkId,
      chunkIndex: item.chunkIndex,
      title: item.document.title,
      content: item.content,
      category: item.document.category,
      team: item.document.team,
      tags: item.document.tags,
      score: 0,
      keywordScore: null,
      semanticScore: item.score,
      sources: ['semantic'],
    };
  }

  private blendedScore(
    keywordScore: number | null | undefined,
    semanticScore: number | null | undefined,
    maxKeywordScore: number,
    maxSemanticScore: number,
  ): number {
    const keywordPart = keywordScore === null || keywordScore === undefined
      ? 0
      : keywordScore / maxKeywordScore;
    const semanticPart = semanticScore === null || semanticScore === undefined
      ? 0
      : semanticScore / maxSemanticScore;
    return keywordPart * 0.4 + semanticPart * 0.6;
  }

  private maxScore(scores: number[]): number {
    const max = Math.max(...scores, 0);
    return max > 0 ? max : 1;
  }
}
