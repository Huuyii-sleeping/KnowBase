import { Injectable } from '@nestjs/common';
import { HybridSearchItem } from '../search/hybrid-search.service';

@Injectable()
export class AnswerGroundingService {
  hasLexicalSupport(question: string, items: HybridSearchItem[]): boolean {
    return this.selectSupportedItems(question, items).length > 0;
  }

  selectSupportedItems(
    question: string,
    items: HybridSearchItem[],
    limit = 1,
  ): HybridSearchItem[] {
    const terms = this.extractTerms(question);
    const latinTerms = terms.filter((term) => /[a-z0-9]/i.test(term));
    const chineseTerms = terms.filter((term) => !/[a-z0-9]/i.test(term));
    if (!terms.length) {
      return items.slice(0, limit);
    }

    return items
      .map((item, index) => ({
        item,
        index,
        support: this.supportScore(latinTerms, chineseTerms, item),
      }))
      .filter(({ support }) => support > 0)
      .sort((left, right) =>
        right.item.rerankScore - left.item.rerankScore
        || right.support - left.support
        || left.index - right.index,
      )
      .slice(0, limit)
      .map(({ item }) => item);
  }

  private supportScore(
    latinTerms: string[],
    chineseTerms: string[],
    item: HybridSearchItem,
  ): number {
    const context = `${item.title} ${item.content ?? ''}`.toLowerCase();
    const latinHits = latinTerms.filter((term) => context.includes(term)).length;
    const chineseHits = chineseTerms.filter((term) => context.includes(term)).length;

    if (latinTerms.length > 0) {
      return latinHits > 0
        ? latinHits + chineseHits
        : 0;
    }
    return chineseHits >= 2 ? chineseHits : 0;
  }

  private extractTerms(value: string): string[] {
    const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
    const latinTerms = normalized.match(/[a-z0-9][a-z0-9._-]*/g) ?? [];
    const chineseText = normalized.match(/[\u4e00-\u9fff]+/g)?.join('') ?? '';
    const chineseTerms = Array.from(
      { length: Math.max(chineseText.length - 1, 0) },
      (_, index) => chineseText.slice(index, index + 2),
    );
    return [...new Set([...latinTerms, ...chineseTerms])];
  }
}
