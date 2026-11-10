import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { type Driver } from 'neo4j-driver';
import { GraphGenerationWriter } from './graph-generation.writer';
import { IndexGenerationStore } from '../../indexing/index-generation.store';

export interface GraphMentionInput {
  chunkId: string;
  entityKey: string;
}

export interface GraphSearchInput {
  query: string;
  allowedDocumentIds: string[];
  maxHops: number;
  limit: number;
}

export interface GraphSearchPath {
  seed: { key: string; name: string; type: string };
  entities: Array<{ key: string; name: string; type: string }>;
  relations: Array<{
    key: string;
    type: string;
    documentId: string;
    chunkId: string;
  }>;
}

@Injectable()
export class GraphIndexService implements OnModuleDestroy {
  private readonly driver: Driver;
  private readonly writer: GraphGenerationWriter;

  constructor(
    config: ConfigService,
    private readonly generations: IndexGenerationStore,
  ) {
    this.driver = neo4j.driver(
      config.get<string>('NEO4J_URI', 'bolt://localhost:17687'),
      neo4j.auth.basic(
        config.get<string>('NEO4J_USER', 'neo4j'),
        config.get<string>('NEO4J_PASSWORD', 'knowbase'),
      ),
    );
    this.writer = new GraphGenerationWriter(this.driver);
  }

  stageDocument(
    ...args: Parameters<GraphGenerationWriter['stageDocument']>
  ): Promise<void> {
    return this.writer.stageDocument(...args);
  }

  async deleteDocument(documentId: string): Promise<void> {
    if (!(await this.generations.isDeleted(documentId, 'kg'))) return;
    await this.writer.remove(documentId);
  }

  async discardGeneration(
    documentId: string,
    generation: string,
  ): Promise<void> {
    await this.writer.remove(documentId, generation);
  }

  async searchRelated(input: GraphSearchInput): Promise<GraphSearchPath[]> {
    if (!input.allowedDocumentIds.length) return [];
    const generations = await this.generations.active(
      'kg',
      input.allowedDocumentIds,
    );
    if (!generations.length) return [];
    const maxHops = Math.min(Math.max(Math.trunc(input.maxHops), 1), 3);
    const session = this.driver.session();
    try {
      const result = await session.executeRead((transaction) =>
        transaction.run(
          `MATCH (seed:KnowledgeEntity)
         WHERE toLower(seed.name) CONTAINS toLower($query)
           AND EXISTS {
             MATCH (seed)<-[:MENTIONS]-(seedChunk:DocumentChunk)
             WHERE seedChunk.documentId IN $allowedDocumentIds
               AND seedChunk.generationId IN $generations
           }
         MATCH path=(seed)-[:RELATED_TO*1..${maxHops}]-(related:KnowledgeEntity)
         WHERE ALL(relation IN relationships(path)
           WHERE relation.documentId IN $allowedDocumentIds AND relation.generationId IN $generations)
         RETURN
           {key: seed.key, name: seed.name, type: seed.type} AS seed,
           [node IN nodes(path) | {key: node.key, name: node.name, type: node.type}] AS entities,
           [relation IN relationships(path) | {
             key: relation.key,
             type: relation.type,
             documentId: relation.documentId,
             chunkId: relation.chunkId
           }] AS relations
         ORDER BY length(path)
         LIMIT $limit`,
          {
            query: input.query,
            allowedDocumentIds: input.allowedDocumentIds,
            generations,
            limit: neo4j.int(input.limit),
          },
        ),
      );
      return result.records.map((record) => ({
        seed: record.get('seed'),
        entities: record.get('entities'),
        relations: record.get('relations'),
      }));
    } finally {
      await session.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver.close();
  }
}
