import { Injectable, Logger } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { KnowledgeGraphQueryService } from '../graph/knowledge-graph-query.service';
import { SearchGraphDto } from '../graph/dto/search-graph.dto';
import { HybridSearchItem, HybridSearchService } from '../search/hybrid-search.service';
import { GraphIntentService } from './graph-intent.service';

export interface AnswerRetrievalResult {
  items: HybridSearchItem[];
  graphUsed: boolean;
}

@Injectable()
export class AnswerRetrievalService {
  private readonly logger = new Logger(AnswerRetrievalService.name);

  constructor(
    private readonly hybridSearch: HybridSearchService,
    private readonly graphQuery: KnowledgeGraphQueryService,
    private readonly graphIntent: GraphIntentService,
  ) {}

  async retrieve(
    question: string,
    topK: number,
    user?: AuthUser,
  ): Promise<AnswerRetrievalResult> {
    const hybrid = await this.hybridSearch.search({ query: question, topK }, user);
    if (!this.graphIntent.shouldUseGraph(question) || !user) {
      return { items: hybrid.items, graphUsed: false };
    }

    try {
      const terms = this.graphIntent.extractTerms(question);
      const graphResults = await Promise.all(terms.map((term) => this.graphQuery.search({
        query: term,
        maxHops: 3,
        limit: Math.min(topK, 10),
      } satisfies SearchGraphDto, user)));
      const graphItems = this.uniqueGraphItems(
        graphResults.flatMap((graph) => graph.items.map((item) => this.toSearchItem(item))),
      ).filter((item) => this.supportsQuestionTerms(item, terms));
      if (terms.length >= 2 && graphItems.length === 0) {
        return { items: [], graphUsed: false };
      }
      return {
        items: [...hybrid.items, ...graphItems],
        graphUsed: graphItems.length > 0,
      };
    } catch (error) {
      this.logger.warn(`Knowledge graph retrieval failed; using hybrid results: ${this.errorMessage(error)}`);
      return { items: hybrid.items, graphUsed: false };
    }
  }

  private uniqueGraphItems(items: HybridSearchItem[]): HybridSearchItem[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.chunkId ?? ''}:${item.content ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private supportsQuestionTerms(item: HybridSearchItem, terms: string[]): boolean {
    if (terms.length < 2) return true;
    const content = `${item.title} ${item.content ?? ''}`.toLocaleLowerCase();
    return terms.filter((term) => content.includes(term)).length >= 2;
  }

  private toSearchItem(path: {
    seed: { name: string; type: string };
    entities: Array<{ name: string; type: string }>;
    relations: Array<{ documentId: string; chunkId: string; type: string }>;
  }): HybridSearchItem {
    const firstRelation = path.relations[0];
    const entityPath = path.entities.map((entity) => `${entity.name}（${entity.type}）`).join(' -> ');
    const relationSummary = path.relations
      .map((relation) => relation.type)
      .filter(Boolean)
      .join('、');

    return {
      documentId: firstRelation.documentId,
      chunkId: firstRelation.chunkId,
      title: `知识图谱路径：${path.seed.name}`,
      content: `实体路径：${entityPath}\n关系：${relationSummary || '相关'}`,
      category: null,
      team: null,
      tags: ['knowledge-graph'],
      score: 1,
      keywordScore: 1,
      semanticScore: null,
      sources: ['graph'],
      rerankScore: 1,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
