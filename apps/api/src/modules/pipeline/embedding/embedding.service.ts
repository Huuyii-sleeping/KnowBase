import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';

export interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
}

@Injectable()
export class EmbeddingService implements EmbeddingProvider {
  private readonly embeddings: OpenAIEmbeddings;

  constructor(config: ConfigService) {
    this.embeddings = new OpenAIEmbeddings({
      apiKey: config.get<string>('OPENAI_API_KEY'),
      model: config.get<string>('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'),
      configuration: {
        baseURL: config.get<string>('OPENAI_BASE_URL'),
      },
    });
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }
}
