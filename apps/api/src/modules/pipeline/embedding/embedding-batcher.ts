export interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
}

export function validVector(
  vector: unknown,
  dimensions: number,
): vector is number[] {
  if (
    !Array.isArray(vector) ||
    vector.length !== dimensions ||
    !Array.from(vector).every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  )
    return false;
  const magnitude = vector.reduce((sum, value) => sum + value * value, 0);
  return Number.isFinite(magnitude) && magnitude > 0;
}

/** Limits work across concurrent documents sharing this provider instance. */
export class EmbeddingBatcher implements EmbeddingProvider {
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly options: {
      dimensions: number;
      batchSize: number;
      maxCharacters: number;
      concurrency: number;
    },
  ) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const unique = [...new Set(texts)];
    const batches: string[][] = [];
    let batch: string[] = [];
    let characters = 0;
    for (const text of unique) {
      if (!text.trim() || text.length > this.options.maxCharacters)
        throw new Error(
          'Embedding input is empty or exceeds RAG_EMBEDDING_BATCH_CHARACTERS.',
        );
      if (
        batch.length &&
        (batch.length >= this.options.batchSize ||
          characters + text.length > this.options.maxCharacters)
      ) {
        batches.push(batch);
        batch = [];
        characters = 0;
      }
      batch.push(text);
      characters += text.length;
    }
    if (batch.length) batches.push(batch);
    const vectors = new Map<string, number[]>();
    let next = 0;
    let failed = false;
    let failure: unknown;
    const worker = async () => {
      while (!failed && next < batches.length) {
        const input = batches[next++];
        await this.acquire();
        try {
          if (failed) return;
          const result = await this.provider.embedDocuments(input);
          if (
            !Array.isArray(result) ||
            result.length !== input.length ||
            !Array.from(result).every((vector) =>
              validVector(vector, this.options.dimensions),
            )
          ) {
            throw new Error(
              'Embedding response contains an invalid count, dimension, non-finite or zero vector.',
            );
          }
          input.forEach((text, index) => vectors.set(text, result[index]));
        } catch (error) {
          failed = true;
          failure = error;
        } finally {
          this.release();
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(this.options.concurrency, batches.length) },
        worker,
      ),
    );
    if (failed) throw failure;
    return texts.map((text) => vectors.get(text)!);
  }

  private async acquire(): Promise<void> {
    if (this.running < this.options.concurrency) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running--;
  }
}
