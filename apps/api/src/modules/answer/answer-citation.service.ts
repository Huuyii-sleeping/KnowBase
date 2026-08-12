import { Injectable } from '@nestjs/common';
import { HybridSearchItem } from '../search/hybrid-search.service';

export interface AnswerCitation {
  sourceId: string;
  documentId: string;
  chunkId?: string;
  chunkIndex?: number;
  title: string;
  score: number;
}

@Injectable()
export class AnswerCitationService {
  build(answer: string, items: HybridSearchItem[]): AnswerCitation[] {
    const citedSourceIds = [...answer.matchAll(/\[S(\d+)\]/g)]
      .map((match) => Number(match[1]))
      .filter((index) => Number.isInteger(index) && index > 0 && index <= items.length);
    const indexes = citedSourceIds.length
      ? [...new Set(citedSourceIds)]
      : items.length
        ? [1]
        : [];

    return indexes.map((index) => {
      const item = items[index - 1];
      return {
        sourceId: `S${index}`,
        documentId: item.documentId,
        chunkId: item.chunkId,
        chunkIndex: item.chunkIndex,
        title: item.title,
        score: item.rerankScore,
      };
    });
  }
}
