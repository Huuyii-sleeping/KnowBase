import { validateAnswerCitations } from './answer-citation-validation';
import { Injectable } from '@nestjs/common';
import { AnswerClaim } from './answer-output';
import { AnswerContentRange, AnswerContextItem } from './answer-context.types';
import {
  HybridSearchItem,
  HybridSearchSource,
} from '../search/hybrid-search.service';

export interface AnswerCitation {
  sourceId: string;
  documentId: string;
  chunkId?: string;
  chunkIndex?: number;
  title: string;
  score: number;
  sourceType: HybridSearchSource;
  quotes?: string[];
  contentRange?: AnswerContentRange;
}

@Injectable()
export class AnswerCitationService {
  build(
    answer: string,
    items: AnswerContextItem[],
    claims: AnswerClaim[] = [],
  ): AnswerCitation[] {
    const validated = validateAnswerCitations(answer, items);
    const indexes = validated?.sourceIds.map((id) => Number(id.slice(1))) ?? [];

    return indexes.map((index) => {
      const item = items[index - 1];
      const quotes = [
        ...new Set(
          claims
            .flatMap((claim) => claim.evidence)
            .filter(
              (reference) =>
                reference.sourceId === `S${index}` &&
                !!reference.quote.trim() &&
                item.content?.includes(reference.quote),
            )
            .map((reference) => reference.quote),
        ),
      ];
      return {
        sourceId: `S${index}`,
        documentId: item.documentId,
        chunkId: item.chunkId,
        chunkIndex: item.chunkIndex,
        title: item.title,
        score: item.rerankScore,
        sourceType: this.sourceType(item),
        ...(quotes.length ? { quotes } : {}),
        ...(item.contentRange ? { contentRange: item.contentRange } : {}),
      };
    });
  }

  private sourceType(item: HybridSearchItem): HybridSearchSource {
    return item.sources.includes('graph')
      ? 'graph'
      : (item.sources[0] ?? 'semantic');
  }
}
