import type { Client, estypes } from '@elastic/elasticsearch';

export class ElasticsearchSchema {
  private readonly initialization = new Map<string, Promise<void>>();
  constructor(
    private readonly client: Client,
    private readonly documentIndex: string,
    private readonly chunkIndex: string,
    private readonly dimensions: number,
  ) {}

  document(): Promise<void> {
    return this.ensure(this.documentIndex, {
      id: { type: 'keyword' },
      generation_id: { type: 'keyword' },
      title: { type: 'text' },
      content: { type: 'text' },
      status: { type: 'keyword' },
      category: { type: 'keyword' },
      team: { type: 'keyword' },
      tags: { type: 'keyword' },
      document_version: { type: 'integer' },
    });
  }

  chunks(): Promise<void> {
    return this.ensure(this.chunkIndex, {
      document_id: { type: 'keyword' },
      generation_id: { type: 'keyword' },
      document_version: { type: 'integer' },
      chunk_index: { type: 'integer' },
      content: {
        type: 'text',
        fields: { cjk: { type: 'text', analyzer: 'cjk' } },
      },
      embedding: {
        type: 'dense_vector',
        dims: this.dimensions,
        index: true,
        similarity: 'cosine',
      },
    });
  }

  private ensure(
    index: string,
    properties: Record<string, estypes.MappingProperty>,
  ): Promise<void> {
    let pending = this.initialization.get(index);
    if (!pending) {
      pending = this.initialize(index, properties).catch((error) => {
        this.initialization.delete(index);
        throw error;
      });
      this.initialization.set(index, pending);
    }
    return pending;
  }

  private async initialize(
    index: string,
    properties: Record<string, estypes.MappingProperty>,
  ): Promise<void> {
    if (!(await this.client.indices.exists({ index }))) {
      try {
        await this.client.indices.create({ index, mappings: { properties } });
        return;
      } catch (error) {
        // Another worker may create the shared index between exists and create.
        if (
          (error as { meta?: { body?: { error?: { type?: string } } } }).meta
            ?.body?.error?.type !== 'resource_already_exists_exception'
        )
          throw error;
      }
    }
    // Existing installations need an explicit keyword mapping before any staged
    // writes; dynamic text mappings would tokenize the generation UUID.
    await this.client.indices.putMapping({
      index,
      properties: {
        generation_id: { type: 'keyword' },
        ...(properties.content && index === this.chunkIndex
          ? { content: properties.content }
          : {}),
      },
    });
  }
}
