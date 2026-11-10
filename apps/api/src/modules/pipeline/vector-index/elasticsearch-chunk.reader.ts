import type { Client, estypes } from '@elastic/elasticsearch';
import type { IndexGenerationStore } from '../../indexing/index-generation.store';
import type { ElasticsearchSchema } from './elasticsearch-schema';
import type {
  KeywordChunkSearchInput,
  VectorChunkSearchInput,
  VectorChunkSearchItem,
} from './vector-index.service';

/** Both retrieval routes read the same active RAG generations and chunk bodies. */
export class ElasticsearchChunkReader {
  constructor(
    private readonly client: Client,
    private readonly index: string,
    private readonly schema: ElasticsearchSchema,
    private readonly generations: IndexGenerationStore,
    private readonly keywordAnalyzer: 'standard' | 'cjk' = 'standard',
    private readonly contextual = false,
  ) {}

  async semantic(
    input: VectorChunkSearchInput,
  ): Promise<VectorChunkSearchItem[]> {
    const generations = await this.generations.active(
      'rag',
      input.allowedDocumentIds,
    );
    if (!generations.length) return [];
    await this.schema.chunks();
    const response = await this.client.search<Record<string, unknown>>({
      index: this.index,
      size: input.topK,
      knn: {
        field: 'embedding',
        query_vector: input.queryVector,
        k: input.topK,
        num_candidates: Math.max(input.topK * 10, 100),
        filter: [{ terms: { generation_id: generations } }],
      },
    });
    return this.items(response.hits.hits);
  }

  async keyword(
    input: KeywordChunkSearchInput,
  ): Promise<VectorChunkSearchItem[]> {
    const query = input.query.trim();
    if (!query) return [];
    const generations = await this.generations.active(
      'rag',
      input.allowedDocumentIds,
    );
    if (!generations.length) return [];
    await this.schema.chunks();
    const response = await this.client.search<Record<string, unknown>>({
      index: this.index,
      size: input.topK,
      query: {
        bool: {
          must: [
            {
              match: {
                [`${this.contextual ? 'retrieval_text' : 'content'}${this.keywordAnalyzer === 'cjk' ? '.cjk' : ''}`]:
                  {
                    query,
                  },
              },
            },
          ],
          filter: [{ terms: { generation_id: generations } }],
        },
      },
    });
    return this.items(response.hits.hits);
  }

  private items(
    hits: estypes.SearchHit<Record<string, unknown>>[],
  ): VectorChunkSearchItem[] {
    return hits.map((hit) => {
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
}
