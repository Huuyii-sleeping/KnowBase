import { Injectable } from '@nestjs/common';
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
}

@Injectable()
export class AnswerCitationService {
  hasValidMarkers(answer: string, sourceCount: number): boolean {
    const markers = [...answer.matchAll(/\[S([^\]]*)\]/g)];
    return (
      markers.length > 0 &&
      markers.every((match) => {
        const index = Number(match[1]);
        return (
          /^[1-9]\d*$/.test(match[1]) &&
          Number.isSafeInteger(index) &&
          index <= sourceCount
        );
      })
    );
  }

  build(answer: string, items: HybridSearchItem[]): AnswerCitation[] {
    const citedSourceIds = [...answer.matchAll(/\[S(\d+)\]/g)]
      .map((match) => Number(match[1]))
      .filter(
        (index) =>
          Number.isInteger(index) && index > 0 && index <= items.length,
      );
    const indexes = [...new Set(citedSourceIds)];

    return indexes.map((index) => {
      const item = items[index - 1];
      return {
        sourceId: `S${index}`,
        documentId: item.documentId,
        chunkId: item.chunkId,
        chunkIndex: item.chunkIndex,
        title: item.title,
        score: item.rerankScore,
        sourceType: this.sourceType(item),
      };
    });
  }

  private sourceType(item: HybridSearchItem): HybridSearchSource {
    return item.sources.includes('graph')
      ? 'graph'
      : (item.sources[0] ?? 'semantic');
  }
}
