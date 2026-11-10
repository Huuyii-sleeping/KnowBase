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
  ) {}

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

    const result = await this.client.bulk({
      refresh: 'wait_for',
      operations: chunks.flatMap((chunk) => [
        {
          index: { _index: this.chunkIndex, _id: `${chunk.id}:${generation}` },
        },
        {
          generation_id: generation,
          document_id: documentId,
          document_version: chunk.version,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          embedding: chunk.embedding,
        },
      ]),
    });
    if (result.errors) {
      throw new Error('Elasticsearch failed to index one or more chunks');
    }
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
