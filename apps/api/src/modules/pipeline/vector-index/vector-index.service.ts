import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';

export interface SearchDocumentInput {
  id: string;
  document: Record<string, unknown>;
}

export interface DocumentSearchInput {
  keyword?: string;
  category?: string;
  team?: string;
  tag?: string;
  page: number;
  pageSize: number;
}

export interface DocumentSearchItem {
  id: string;
  title: string;
  fileName?: string;
  category?: string | null;
  team?: string | null;
  tags?: string[];
  version?: number;
  score: number | null;
  highlights: Record<string, string[]>;
}

export interface DocumentSearchResult {
  items: DocumentSearchItem[];
  page: number;
  pageSize: number;
  total: number;
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
    this.embeddingDimensions = Number(
      config.get<string | number>('RAG_EMBEDDING_DIMENSIONS', 768),
    );
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

  async searchDocuments(input: DocumentSearchInput): Promise<DocumentSearchResult> {
    const must = input.keyword
      ? [{
          multi_match: {
            query: input.keyword,
            fields: ['title^3', 'content', 'tags^2', 'category', 'team'],
            type: 'best_fields' as const,
          },
        }]
      : [{ match_all: {} }];
    const filter = [
      { term: { status: 'PUBLISHED' } },
      ...(input.category ? [{ term: { category: input.category } }] : []),
      ...(input.team ? [{ term: { team: input.team } }] : []),
      ...(input.tag ? [{ term: { tags: input.tag } }] : []),
    ];
    const response = await this.client.search<Record<string, unknown>>({
      index: this.documentIndex,
      from: (input.page - 1) * input.pageSize,
      size: input.pageSize,
      track_total_hits: true,
      query: { bool: { must, filter } },
      ...(input.keyword
        ? {
            highlight: {
              fields: {
                title: {},
                content: { fragment_size: 180, number_of_fragments: 2 },
              },
            },
            sort: [{ _score: 'desc' }, { updatedAt: 'desc' }],
          }
        : { sort: [{ updatedAt: 'desc' }] }),
    });

    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : response.hits.total?.value ?? 0;

    return {
      items: response.hits.hits.map((hit) => {
        const source = hit._source ?? {};
        return {
          id: String(source.id ?? hit._id),
          title: String(source.title ?? ''),
          fileName: this.optionalString(source.fileName),
          category: this.optionalString(source.category),
          team: this.optionalString(source.team),
          tags: Array.isArray(source.tags) ? source.tags.map(String) : [],
          version: this.optionalNumber(source.version),
          score: hit._score ?? null,
          highlights: hit.highlight ?? {},
        };
      }),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
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

  private optionalString(value: unknown): string | undefined {
    return value === null || value === undefined ? undefined : String(value);
  }

  private optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }
}
