import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EmbeddingCacheStore } from '../../ingestion/artifacts/embedding-cache.store';
import { ingestionStage } from '../../ingestion/ingestion-stage';
import { EmbeddingService } from './embedding.service';
import { validVector } from './embedding-batcher';

@Injectable()
export class DocumentEmbeddingService {
  private readonly logger = new Logger(DocumentEmbeddingService.name);
  constructor(
    private readonly provider: EmbeddingService,
    private readonly cache: EmbeddingCacheStore,
  ) {}

  get fingerprint(): string | undefined {
    return this.provider.fingerprint;
  }

  async embed(
    documentId: string,
    texts: string[],
    onProgress?: (completed: number, total: number) => Promise<void>,
  ): Promise<number[][]> {
    // Reused vectors must obey the active input budget too.
    this.provider.validateInputs?.(texts);
    const fingerprint = this.provider.fingerprint;
    if (!fingerprint) {
      const result = await ingestionStage(
        'embedding',
        { documentId, inputs: texts.length, cache: 'disabled' },
        () => this.provider.embedDocuments(texts),
      );
      await onProgress?.(texts.length, texts.length);
      return result;
    }
    // The document ID is part of the key: reuse never crosses an authorization scope.
    const keys = texts.map((text) =>
      createHash('sha256')
        .update(JSON.stringify([documentId, fingerprint, text]))
        .digest('hex'),
    );
    let found = new Map<string, number[]>();
    try {
      found = await this.cache.find([...new Set(keys)]);
    } catch {
      this.logger.warn(
        `Embedding cache read unavailable for ${documentId}; recomputing.`,
      );
    }
    const missing = new Map<string, string>();
    keys.forEach((key, i) => {
      if (!validVector(found.get(key), this.provider.dimensions))
        missing.set(key, texts[i]);
    });
    const entries = [...missing.entries()];
    const keyByText = new Map(entries.map(([key, text]) => [text, key]));
    const persisted = new Set<string>();
    const occurrences = new Map<string, number>();
    keys.forEach((key) =>
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1),
    );
    const completedKeys = new Set(
      keys.filter((key) =>
        validVector(found.get(key), this.provider.dimensions),
      ),
    );
    let completed = keys.filter((key) => completedKeys.has(key)).length;
    const report = async () => onProgress?.(completed, texts.length);
    const save = async (saved: Array<{ key: string; vector: number[] }>) => {
      for (const entry of saved) {
        found.set(entry.key, entry.vector);
        if (!completedKeys.has(entry.key)) {
          completedKeys.add(entry.key);
          completed += occurrences.get(entry.key) ?? 0;
        }
      }
      try {
        if (saved.length) await this.cache.save(documentId, saved);
        saved.forEach((entry) => persisted.add(entry.key));
      } catch {
        this.logger.warn(
          `Embedding cache write unavailable for ${documentId}; completed batches may require recomputation.`,
        );
      }
      await report();
    };
    await report();
    const fresh = entries.length
      ? await ingestionStage(
          'embedding',
          {
            documentId,
            inputs: texts.length,
            misses: entries.length,
            fingerprint,
          },
          () =>
            this.provider.embedDocuments(
              entries.map(([, text]) => text),
              async (batch, vectors) => {
                if (
                  !Array.isArray(batch) ||
                  !Array.isArray(vectors) ||
                  batch.length !== vectors.length ||
                  new Set(batch).size !== batch.length ||
                  Array.from(batch).some((text) => !keyByText.has(text)) ||
                  !Array.from(vectors).every((vector) =>
                    validVector(vector, this.provider.dimensions),
                  )
                )
                  throw new Error(
                    'Invalid completed embedding batch; cache was not updated.',
                  );
                await save(
                  batch.map((text, index) => ({
                    key: keyByText.get(text)!,
                    vector: vectors[index],
                  })),
                );
              },
            ),
        )
      : [];
    if (
      !Array.isArray(fresh) ||
      fresh.length !== entries.length ||
      !Array.from(fresh).every((vector) =>
        validVector(vector, this.provider.dimensions),
      )
    )
      throw new Error(
        'Invalid embedding response; incomplete vectors were not cached.',
      );
    // Compatibility with providers without incremental callbacks; retry cache writes that failed transiently.
    const remaining = entries.flatMap(([key], i) =>
      persisted.has(key) ? [] : [{ key, vector: fresh[i] }],
    );
    if (remaining.length) await save(remaining);
    this.logger.log(
      JSON.stringify({
        documentId,
        stage: 'embedding.cache',
        inputs: texts.length,
        misses: entries.length,
        hits: texts.length - entries.length,
        fingerprint,
      }),
    );
    return keys.map((key) => found.get(key)!);
  }
}
