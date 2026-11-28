import type { Client } from '@elastic/elasticsearch';
import type {
  SearchDocumentInput,
  VectorChunkInput,
} from './vector-index.service';
import { ElasticsearchSchema } from './elasticsearch-schema';

export class ElasticsearchGenerationWriter {
  constructor(
    private readonly client: Client,
    private readonly documentIndex: string,
    private readonly chunkIndex: string,
    private readonly schema: ElasticsearchSchema,
    private readonly limits = { maxChunks: 200, maxBytes: 5242880 },
  ) {
    if (
      !Number.isSafeInteger(limits.maxChunks) ||
      limits.maxChunks < 1 ||
      !Number.isSafeInteger(limits.maxBytes) ||
      limits.maxBytes < 1
    )
      throw new Error('Invalid Elasticsearch bulk limits');
  }

  async indexDocument(input: SearchDocumentInput): Promise<void> {
    await this.schema.document();
    await this.client.index({
      index: this.documentIndex,
      id: `${input.id}:${input.generation}`,
      document: {
        ...input.document,
        id: input.id,
        generation_id: input.generation,
      },
      refresh: 'wait_for',
    });
  }

  async stageChunks(
    documentId: string,
    generation: string,
    chunks: VectorChunkInput[],
  ): Promise<void> {
    await this.schema.chunks();

    if (chunks.length === 0) {
      return;
    }

    let operations: Record<string, unknown>[] = [];
    let bytes = 0;
    const flush = async () => {
      if (!operations.length) return;
      const result = await this.client.bulk({ refresh: false, operations });
      if (result.errors)
        throw new Error('Elasticsearch failed to index one or more chunks');
      operations = [];
      bytes = 0;
    };
    for (const chunk of chunks) {
      const pair = [
        {
          index: { _index: this.chunkIndex, _id: `${chunk.id}:${generation}` },
        },
        {
          generation_id: generation,
          document_id: documentId,
          document_version: chunk.version,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          retrieval_text: chunk.retrievalText ?? chunk.content,
          embedding: chunk.embedding,
          ...(chunk.metadata ? { ingestion: chunk.metadata } : {}),
        },
      ];
      const size = pair.reduce(
        (sum, item) => sum + Buffer.byteLength(JSON.stringify(item)) + 1,
        0,
      );
      if (size > this.limits.maxBytes)
        throw new Error('A chunk exceeds ES_BULK_MAX_BYTES');
      if (
        operations.length / 2 >= this.limits.maxChunks ||
        bytes + size > this.limits.maxBytes
      )
        await flush();
      operations.push(...pair);
      bytes += size;
    }
    await flush();
    // Activation follows a single refresh barrier after every batch has succeeded.
    const refreshed = await this.client.indices.refresh({
      index: this.chunkIndex,
    });
    if (!refreshed._shards || refreshed._shards.failed)
      throw new Error('Elasticsearch chunk refresh failed');
  }

  async discardGeneration(
    pipeline: 'search' | 'rag',
    generation: string,
  ): Promise<void> {
    await this.deleteMatching(pipeline, {
      term: { generation_id: generation },
    });
  }

  async deleteDocument(
    documentId: string,
    pipeline: 'search' | 'rag',
  ): Promise<void> {
    await this.deleteMatching(pipeline, {
      term: { [pipeline === 'search' ? 'id' : 'document_id']: documentId },
    });
  }

  private async deleteMatching(
    pipeline: 'search' | 'rag',
    query: { term: Record<string, string> },
  ): Promise<void> {
    const index = pipeline === 'search' ? this.documentIndex : this.chunkIndex;
    if (!(await this.client.indices.exists({ index }))) return;
    const result = await this.client.deleteByQuery({
      index,
      query,
      refresh: true,
    });
    if (
      result.failures?.length ||
      result.version_conflicts ||
      result.timed_out
    ) {
      throw new Error('Elasticsearch index cleanup was incomplete');
    }
  }
}
