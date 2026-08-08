import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { OllamaEmbeddings } from '@langchain/ollama';

export interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
}

@Injectable()
export class EmbeddingService implements EmbeddingProvider {
  private readonly embeddings: EmbeddingProvider;

  constructor(config: ConfigService) {
    const provider = config
      .get<string>('EMBEDDING_PROVIDER', 'ollama')
      .toLowerCase();

    if (provider === 'openai') {
      this.embeddings = new OpenAIEmbeddings({
        apiKey: config.get<string>('OPENAI_API_KEY'),
        model: config.get<string>(
          'OPENAI_EMBEDDING_MODEL',
          'text-embedding-3-small',
        ),
        configuration: {
          baseURL: config.get<string>('OPENAI_BASE_URL'),
        },
      });
      return;
    }

    if (provider === 'ollama') {
      this.embeddings = new OllamaEmbeddings({
        baseUrl: config.get<string>(
          'OLLAMA_BASE_URL',
          'http://localhost:11434',
        ),
        model: config.get<string>(
          'OLLAMA_EMBEDDING_MODEL',
          'nomic-embed-text',
        ),
      });
      return;
    }

    throw new Error(`unsupported embedding provider: ${provider}`);
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }
}
