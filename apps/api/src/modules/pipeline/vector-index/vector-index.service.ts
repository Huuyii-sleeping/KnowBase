import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, type estypes } from '@elastic/elasticsearch';
import { ElasticsearchGenerationWriter } from './elasticsearch-generation.writer';
import { ElasticsearchSchema } from './elasticsearch-schema';
import { IndexGenerationStore } from '../../indexing/index-generation.store';

export interface SearchDocumentInput {
  id: string;
  generation: string;
  document: Record<string, unknown>;
}

export interface DocumentSearchInput {
  keyword?: string;
  category?: string;
  team?: string;
  tag?: string;
  page: number;
  pageSize: number;
  allowedDocumentIds?: string[];
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

export interface VectorChunkSearchInput {
  queryVector: number[];
  topK: number;
  allowedDocumentIds?: string[];
}

export interface VectorChunkSearchItem {
  id: string;
  documentId: string;
  version: number;
  chunkIndex: number;
  content: string;
  score: number | null;
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
  private readonly client: Client;
  private readonly documentIndex: string;
  private readonly chunkIndex: string;
  private readonly schema: ElasticsearchSchema;
  private readonly writer: ElasticsearchGenerationWriter;

  constructor(
    config: ConfigService,
    private readonly generations: IndexGenerationStore,
  ) {
    this.client = new Client({
      node: config.get<string>('ELASTICSEARCH_NODE', 'http://localhost:19200'),
      auth: config.get<string>('ELASTICSEARCH_API_KEY')
        ? { apiKey: config.getOrThrow<string>('ELASTICSEARCH_API_KEY') }
        : undefined,
    });
    this.documentIndex = config.get<string>(
      'ELASTICSEARCH_DOCUMENT_INDEX',
      'kh_document',
    );
    this.chunkIndex = config.get<string>(
      'ELASTICSEARCH_CHUNK_INDEX',
      'kh_chunk',
    );
    const embeddingDimensions = Number(
      config.get<string | number>('RAG_EMBEDDING_DIMENSIONS', 768),
    );
    this.schema = new ElasticsearchSchema(
      this.client,
      this.documentIndex,
      this.chunkIndex,
      embeddingDimensions,
    );
    this.writer = new ElasticsearchGenerationWriter(
      this.client,
      this.documentIndex,
      this.chunkIndex,
      this.schema,
    );
  }

  indexDocument(input: SearchDocumentInput): Promise<void> {
    return this.writer.indexDocument(input);
  }

  async searchDocuments(
    input: DocumentSearchInput,
  ): Promise<DocumentSearchResult> {
    const generations = await this.generations.active(
      'search',
      input.allowedDocumentIds,
    );
    if (!generations.length)
      return {
        items: [],
        total: 0,
        page: input.page,
        pageSize: input.pageSize,
      };
    const must = input.keyword
      ? [
          {
            multi_match: {
              query: input.keyword,
              fields: ['title^3', 'content', 'tags^2', 'category', 'team'],
              type: 'best_fields' as const,
            },
          },
        ]
      : [{ match_all: {} }];
    const filter: estypes.QueryDslQueryContainer[] = [
      { terms: { generation_id: generations } },
      { term: { status: 'PUBLISHED' } },
      ...(input.allowedDocumentIds
        ? [{ terms: { id: input.allowedDocumentIds } }]
        : []),
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

    const total =
      typeof response.hits.total === 'number'
        ? response.hits.total
        : (response.hits.total?.value ?? 0);

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

  async searchChunks(
    input: VectorChunkSearchInput,
  ): Promise<VectorChunkSearchItem[]> {
    const generations = await this.generations.active(
      'rag',
      input.allowedDocumentIds,
    );
    if (!generations.length) return [];
    await this.schema.chunks();
    const response = await this.client.search<Record<string, unknown>>({
      index: this.chunkIndex,
      size: input.topK,
      knn: {
        field: 'embedding',
        query_vector: input.queryVector,
        k: input.topK,
        num_candidates: Math.max(input.topK * 10, 100),
        filter: [{ terms: { generation_id: generations } }],
      },
    });

    return response.hits.hits.map((hit) => {
      const source = hit._source ?? {};
      return {
        id: String(source.id ?? hit._id),
        documentId: String(source.document_id ?? ''),
        version: Number(source.document_version ?? 0),
        chunkIndex: Number(source.chunk_index ?? 0),
        content: String(source.content ?? ''),
        score: hit._score ?? null,
      };
    });
  }

  stageChunks(
    documentId: string,
    generation: string,
    chunks: VectorChunkInput[],
  ): Promise<void> {
    return this.writer.stageChunks(documentId, generation, chunks);
  }

  discardGeneration(
    pipeline: 'search' | 'rag',
    generation: string,
  ): Promise<void> {
    return this.writer.discardGeneration(pipeline, generation);
  }

  async deleteDocument(
    documentId: string,
    pipeline: 'search' | 'rag',
  ): Promise<void> {
    if (!(await this.generations.isDeleted(documentId, pipeline))) return;
    await this.writer.deleteDocument(documentId, pipeline);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }

  private optionalString(value: unknown): string | undefined {
    return value === null || value === undefined ? undefined : String(value);
  }

  private optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }
}
