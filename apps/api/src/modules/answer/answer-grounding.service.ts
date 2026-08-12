import { Injectable } from '@nestjs/common';
import { HybridSearchItem } from '../search/hybrid-search.service';

@Injectable()
export class AnswerGroundingService {
  hasLexicalSupport(question: string, items: HybridSearchItem[]): boolean {
    const terms = this.extractTerms(question);
    if (!terms.length) {
      return items.length > 0;
    }
    const context = items
      .map((item) => `${item.title} ${item.content ?? ''}`)
      .join(' ')
      .toLowerCase();
    const latinTerms = terms.filter((term) => /[a-z0-9]/i.test(term));
    if (latinTerms.length > 0) {
      return latinTerms.some((term) => context.includes(term));
    }

    const chineseHits = terms.filter((term) => context.includes(term));
    return new Set(chineseHits).size >= 2;
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
