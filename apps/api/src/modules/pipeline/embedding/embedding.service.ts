import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { OllamaEmbeddings } from '@langchain/ollama';
import { createHash } from 'node:crypto';
import { integerOption } from '../../ingestion/numeric-option';
import {
  EmbeddingBatcher,
  EmbeddingProvider,
  EmbeddingBatchCallback,
} from './embedding-batcher';
import { EmbeddingInputBudget } from './embedding-input-budget';
export type { EmbeddingProvider } from './embedding-batcher';

@Injectable()
export class EmbeddingService implements EmbeddingProvider {
  private readonly embeddings: EmbeddingProvider;
  private readonly inputBudget: EmbeddingInputBudget;
  readonly fingerprint?: string;
  readonly dimensions: number;

  constructor(config: ConfigService) {
    const provider = config
      .get<string>('EMBEDDING_PROVIDER', 'ollama')
      .toLowerCase();
    this.dimensions = integerOption(config, 'RAG_EMBEDDING_DIMENSIONS', 768);
    const batchSize = integerOption(config, 'RAG_EMBEDDING_BATCH_SIZE', 32);
    const concurrency = integerOption(config, 'RAG_EMBEDDING_CONCURRENCY', 2);
    const timeout = integerOption(config, 'RAG_EMBEDDING_TIMEOUT_MS', 60000);
    let adapter: EmbeddingProvider;
    let model: string;
    let endpoint: string;
    if (provider === 'openai') {
      model = config.get<string>(
        'OPENAI_EMBEDDING_MODEL',
        'text-embedding-3-small',
      );
      endpoint =
        config.get<string>('OPENAI_BASE_URL')?.trim() ||
        'https://api.openai.com/v1';
      adapter = new OpenAIEmbeddings({
        apiKey: config.get<string>('OPENAI_API_KEY'),
        model,
        ...(model.startsWith('text-embedding-3-')
          ? { dimensions: this.dimensions }
          : {}),
        configuration: { baseURL: endpoint },
        batchSize,
        maxConcurrency: concurrency,
        maxRetries: 0,
        timeout,
        stripNewLines: false,
      });
    } else if (provider === 'ollama') {
      model = config.get<string>('OLLAMA_EMBEDDING_MODEL', 'nomic-embed-text');
      endpoint =
        config.get<string>('OLLAMA_BASE_URL')?.trim() ||
        'http://localhost:11434';
      adapter = new OllamaEmbeddings({
        baseUrl: endpoint,
        model,
        truncate: false,
        maxRetries: 0,
        maxConcurrency: concurrency,
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              AbortSignal.timeout(timeout),
              ...(init?.signal
                ? [init.signal]
                : input instanceof Request
                  ? [input.signal]
                  : []),
            ]),
          }),
      });
    } else throw new Error(`unsupported embedding provider: ${provider}`);
    const maxTokens = config.get<string>('RAG_EMBEDDING_MAX_TOKENS')?.trim();
    this.inputBudget = new EmbeddingInputBudget(
      provider,
      model,
      maxTokens ? Number(maxTokens) : undefined,
    );
    const revision = config.get<string>('EMBEDDING_MODEL_REVISION', '').trim();
    // A mutable model alias is insufficient for safe persistent vector reuse.
    if (revision)
      this.fingerprint = createHash('sha256')
        .update(
          JSON.stringify([
            provider,
            endpoint.replace(/\/$/, ''),
            model,
            revision,
            this.dimensions,
            'verbatim-v1',
          ]),
        )
        .digest('hex');
    this.embeddings = new EmbeddingBatcher(adapter, {
      dimensions: this.dimensions,
      batchSize,
      concurrency,
      maxCharacters: integerOption(
        config,
        'RAG_EMBEDDING_BATCH_CHARACTERS',
        24000,
      ),
    });
  }

  embedDocuments(
    texts: string[],
    onBatch?: EmbeddingBatchCallback,
  ): Promise<number[][]> {
    this.validateInputs(texts);
    return this.embeddings.embedDocuments(texts, onBatch);
  }

  validateInputs(texts: string[]): void {
    this.inputBudget.validate(texts);
  }
}
