import { Injectable } from '@nestjs/common';

@Injectable()
export class GraphIntentService {
  private readonly questionStopWords = new Set([
    '有什么关系',
    '什么关系',
    '如何关系',
    '是什么',
    '有哪些',
    '哪些',
    '怎么做',
    '如何做',
    '为什么',
    '多少',
    '请问',
    '能否',
    '是否',
  ]);

  private readonly termSeparators = /(?:和|与|跟|及|以及|之间|关联|关系|依赖|上下游|影响|是什么|有哪些|哪些|如何|怎么|为什么|多少|的)/g;

  private readonly graphSignals = [
    '关系',
    '关联',
    '依赖',
    '上下游',
    '多跳',
    '路径',
    '链路',
    '影响',
    '组成',
    '连接',
    '谁负责',
    '基于什么',
    '之间',
  ];

  shouldUseGraph(question: string): boolean {
    const normalized = question.trim().toLocaleLowerCase();
    return this.graphSignals.some((signal) => normalized.includes(signal));
  }

  extractTerms(question: string): string[] {
    const normalized = question
      .toLocaleLowerCase()
      .replace(/[?？!！。；;，,]/g, ' ')
      .replace(/有什么关系|什么关系|如何关系/g, ' ');
    const latinTerms = normalized.match(/[a-z0-9][a-z0-9._-]*/g) ?? [];
    const chineseTerms = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
    const splitChineseTerms = chineseTerms.flatMap((term) => term.split(this.termSeparators));
    return [...new Set([...latinTerms, ...splitChineseTerms])]
      .filter((term) => !this.questionStopWords.has(term))
      .filter((term) => term.length >= 2)
      .slice(0, 4);
  }
}
