import { getEncoding } from 'js-tiktoken';

const OPENAI_MODELS = new Set([
  'text-embedding-3-small',
  'text-embedding-3-large',
  'text-embedding-ada-002',
]);
let encoder: ReturnType<typeof getEncoding> | undefined;

/** Only use a tokenizer when its mapping to the configured model is known. */
export class EmbeddingInputBudget {
  private readonly limit?: number;
  constructor(provider: string, model: string, limit?: number) {
    const known = provider === 'openai' && OPENAI_MODELS.has(model);
    if (
      limit !== undefined &&
      (!Number.isSafeInteger(limit) || limit < 1 || !known)
    )
      throw new Error(
        'RAG_EMBEDDING_MAX_TOKENS requires a positive integer and a supported OpenAI embedding model.',
      );
    if (known) this.limit = Math.min(limit ?? 8191, 8191);
  }
  validate(texts: string[]): void {
    if (this.limit === undefined) return;
    // Bundled ranks: token counting never downloads tokenizer data at runtime.
    encoder ??= getEncoding('cl100k_base');
    for (const text of texts) {
      // Treat special-token-looking user text as ordinary text, without rewriting it.
      const count = encoder.encode(text, [], []).length;
      if (count > this.limit)
        throw new Error(
          `Embedding input has ${count} tokens; limit is ${this.limit}. Reduce the chunk budget.`,
        );
    }
  }
}
