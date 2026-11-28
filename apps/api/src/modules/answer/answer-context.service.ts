import { Injectable } from '@nestjs/common';
import { HybridSearchItem } from '../search/hybrid-search.service';
import { ANSWER_PROMPT_MAX_BYTES } from './answer-budget';
import { AnswerPromptService } from './answer-prompt.service';
import { AnswerContextItem } from './answer-context.types';
import { excerptAnswerSource } from './answer-source-excerpts';

export interface AnswerContextOptions {
  maxItems?: number;
  maxPromptBytes?: number;
}

@Injectable()
export class AnswerContextService {
  constructor(private readonly prompt: AnswerPromptService) {}

  build(
    question: string,
    items: HybridSearchItem[],
    options: AnswerContextOptions = {},
  ) {
    const maxItems = options.maxItems ?? 5;
    const maxPromptBytes = options.maxPromptBytes ?? ANSWER_PROMPT_MAX_BYTES;
    if (
      !Number.isInteger(maxItems) ||
      maxItems < 1 ||
      maxItems > 10 ||
      !Number.isInteger(maxPromptBytes) ||
      maxPromptBytes < 1 ||
      maxPromptBytes > ANSWER_PROMPT_MAX_BYTES
    ) {
      throw new Error('Invalid answer context budget');
    }
    // Candidates already passed retrieval, reranking and access/version checks.
    // A second literal gate can discard complementary current rules or exceptions.
    const seen = new Set<string>();
    const usable = items.filter((item) => {
      if (!item.content?.trim()) return false;
      const key = JSON.stringify([
        item.documentId,
        item.chunkId,
        item.sources.includes('graph'),
        item.content,
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Graph scores are constants, not comparable to model logits or rule scores.
    // Reserve one requested graph path, then preserve the upstream document order.
    const graph = usable.find((item) => item.sources.includes('graph'));
    const admission = graph
      ? [graph, ...usable.filter((item) => item !== graph)]
      : usable;
    const selected = new Set<HybridSearchItem>();
    for (const item of admission) {
      if (selected.size >= maxItems) break;
      const proposed = usable.filter(
        (candidate) => selected.has(candidate) || candidate === item,
      );
      const text = this.prompt.build(question, proposed);
      // Bound complete input including the fixed repair instruction.
      if (Buffer.byteLength(this.prompt.repair(text), 'utf8') <= maxPromptBytes)
        selected.add(item);
    }
    const contexts: AnswerContextItem[] = usable.filter((item) =>
      selected.has(item),
    );
    const represented = new Set(selected);
    // Preserve every admitted full source before supplementing oversized ones.
    // Excerpts must not displace useful evidence when the five slots are full.
    for (const item of admission) {
      if (contexts.length >= maxItems) break;
      if (
        selected.has(item) ||
        Buffer.byteLength(
          this.prompt.repair(this.prompt.build(question, [item])),
        ) <= maxPromptBytes
      )
        continue;
      for (const excerpt of excerptAnswerSource(question, item)) {
        if (contexts.length >= maxItems) break;
        const text = this.prompt.build(question, [...contexts, excerpt]);
        if (Buffer.byteLength(this.prompt.repair(text)) <= maxPromptBytes) {
          contexts.push(excerpt);
          represented.add(item);
        }
      }
    }
    const text = contexts.length ? this.prompt.build(question, contexts) : '';
    return {
      items: contexts,
      selectionPolicy: 'upstream-ranked' as const,
      prompt: text,
      promptBytes: Buffer.byteLength(text, 'utf8'),
      omittedCount: items.length - represented.size,
    };
  }
}
