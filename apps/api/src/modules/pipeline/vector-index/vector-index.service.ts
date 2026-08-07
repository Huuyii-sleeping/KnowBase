import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';

export interface SearchDocumentInput {
  id: string;
  document: Record<string, unknown>;
}

export interface VectorChunkInput {
  id: string;
  documentId: string;
  version: number;
  chunkIndex: number;
  content: string;
  embedding: number[];
}

@Injectable()
export class VectorIndexService implements OnModuleDestroy {
  private readonly logger = new Logger(VectorIndexService.name);
  private readonly client: Client;
  private readonly documentIndex: string;
  private readonly chunkIndex: string;
  private readonly embeddingDimensions: number;

  constructor(config: ConfigService) {
    this.client = new Client({
      node: config.get<string>('ELASTICSEARCH_NODE', 'http://localhost:19200'),
      auth: config.get<string>('ELASTICSEARCH_API_KEY')
        ? { apiKey: config.getOrThrow<string>('ELASTICSEARCH_API_KEY') }
        : undefined,
    });
    this.documentIndex = config.get<string>('ELASTICSEARCH_DOCUMENT_INDEX', 'kh_document');
    this.chunkIndex = config.get<string>('ELASTICSEARCH_CHUNK_INDEX', 'kh_chunk');
    this.embeddingDimensions = config.get<number>('RAG_EMBEDDING_DIMENSIONS', 1536);
  }

  async indexDocument(input: SearchDocumentInput): Promise<void> {
    await this.ensureDocumentIndex();
    await this.client.index({
      index: this.documentIndex,
      id: input.id,
      document: input.document,
      refresh: 'wait_for',
    });
  }

  async replaceChunks(documentId: string, chunks: VectorChunkInput[]): Promise<void> {
    await this.ensureChunkIndex();
    await this.client.deleteByQuery({
      index: this.chunkIndex,
      query: { term: { document_id: documentId } },
      refresh: true,
      conflicts: 'proceed',
    });

    if (chunks.length === 0) {
      return;
    }

    await this.client.bulk({
      refresh: 'wait_for',
      operations: chunks.flatMap((chunk) => [
        { index: { _index: this.chunkIndex, _id: chunk.id } },
        {
          document_id: chunk.documentId,
          document_version: chunk.version,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          embedding: chunk.embedding,
        },
      ]),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }

  private async ensureDocumentIndex(): Promise<void> {
    if (await this.client.indices.exists({ index: this.documentIndex })) {
      return;
    }

    await this.client.indices.create({
      index: this.documentIndex,
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: { type: 'text' },
          content: { type: 'text' },
          status: { type: 'keyword' },
          category: { type: 'keyword' },
          team: { type: 'keyword' },
          tags: { type: 'keyword' },
          document_version: { type: 'integer' },
        },
      },
    });
    this.logger.log(`Created Elasticsearch index: ${this.documentIndex}`);
  }

  private async ensureChunkIndex(): Promise<void> {
    if (await this.client.indices.exists({ index: this.chunkIndex })) {
      return;
    }

    await this.client.indices.create({
      index: this.chunkIndex,
      mappings: {
        properties: {
          document_id: { type: 'keyword' },
          document_version: { type: 'integer' },
          chunk_index: { type: 'integer' },
          content: { type: 'text' },
          embedding: {
            type: 'dense_vector',
            dims: this.embeddingDimensions,
            index: true,
            similarity: 'cosine',
          },
        },
      },
    });
    this.logger.log(`Created Elasticsearch index: ${this.chunkIndex}`);
  }
}
