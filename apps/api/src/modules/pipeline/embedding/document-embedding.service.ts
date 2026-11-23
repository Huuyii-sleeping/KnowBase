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

  async embed(documentId: string, texts: string[]): Promise<number[][]> {
    const fingerprint = this.provider.fingerprint;
    if (!fingerprint)
      return ingestionStage(
        'embedding',
        { documentId, inputs: texts.length, cache: 'disabled' },
        () => this.provider.embedDocuments(texts),
      );
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
    const fresh = entries.length
      ? await ingestionStage(
          'embedding',
          {
            documentId,
            inputs: texts.length,
            misses: entries.length,
            fingerprint,
          },
          () => this.provider.embedDocuments(entries.map(([, text]) => text)),
        )
      : [];
    if (
      !Array.isArray(fresh) ||
      fresh.length !== entries.length ||
      !Array.from(fresh).every((vector) =>
        validVector(vector, this.provider.dimensions),
      )
    )
      throw new Error('Invalid embedding response; cache was not updated.');
    const saved = entries.map(([key], i) => ({ key, vector: fresh[i] }));
    for (const entry of saved) found.set(entry.key, entry.vector);
    try {
      if (saved.length) await this.cache.save(documentId, saved);
    } catch {
      this.logger.warn(
        `Embedding cache write unavailable for ${documentId}; continuing with computed vectors.`,
      );
    }
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
