import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { type Driver } from 'neo4j-driver';

export interface GraphChunkInput {
  id: string;
  documentId: string;
  version: number;
  chunkIndex: number;
  content: string;
}

export interface GraphEntityInput {
  key: string;
  name: string;
  type: string;
}

export interface GraphRelationInput {
  key: string;
  sourceKey: string;
  targetKey: string;
  type: string;
  chunkId: string;
}

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

  constructor(config: ConfigService) {
    this.driver = neo4j.driver(
      config.get<string>('NEO4J_URI', 'bolt://localhost:17687'),
      neo4j.auth.basic(
        config.get<string>('NEO4J_USER', 'neo4j'),
        config.get<string>('NEO4J_PASSWORD', 'knowbase'),
      ),
    );
  }

  async replaceDocument(
    documentId: string,
    version: number,
    chunks: GraphChunkInput[],
    entities: GraphEntityInput[] = [],
    mentions: GraphMentionInput[] = [],
    relations: GraphRelationInput[] = [],
  ): Promise<void> {
    const session = this.driver.session();
    try {
      await session.executeWrite(async (transaction) => {
        await transaction.run(
          `MATCH ()-[r:RELATED_TO {documentId: $documentId}]-()
           DELETE r`,
          { documentId },
        );
        await transaction.run(
          'MATCH (d:Document {id: $documentId}) DETACH DELETE d',
          { documentId },
        );
        await transaction.run(
          'MATCH (e:Entity) WHERE NOT (e)<-[:MENTIONS]-() DETACH DELETE e',
        );
        await transaction.run(
          'MERGE (d:Document {id: $documentId}) SET d.version = $version',
          { documentId, version: neo4j.int(version) },
        );
        await transaction.run(
          `UNWIND $chunks AS chunk
           MATCH (d:Document {id: $documentId})
           CREATE (c:DocumentChunk {
             id: chunk.id,
             documentId: $documentId,
             version: chunk.version,
             chunkIndex: chunk.chunkIndex,
             content: chunk.content
           })
           CREATE (d)-[:HAS_CHUNK]->(c)`,
          {
            documentId,
            chunks: chunks.map((chunk) => ({
              id: chunk.id,
              version: neo4j.int(chunk.version),
              chunkIndex: neo4j.int(chunk.chunkIndex),
              content: chunk.content,
            })),
          },
        );
        await transaction.run(
          `UNWIND $entities AS entity
           MERGE (e:Entity {key: entity.key})
           SET e.name = entity.name, e.type = entity.type`,
          { entities },
        );
        await transaction.run(
          `UNWIND $mentions AS mention
           MATCH (c:DocumentChunk {id: mention.chunkId})
           MATCH (e:Entity {key: mention.entityKey})
           MERGE (c)-[:MENTIONS]->(e)`,
          { mentions },
        );
        await transaction.run(
          `UNWIND $relations AS relation
           MATCH (source:Entity {key: relation.sourceKey})
           MATCH (target:Entity {key: relation.targetKey})
           MERGE (source)-[r:RELATED_TO {key: relation.key}]->(target)
           SET r.type = relation.type,
               r.documentId = $documentId,
               r.chunkId = relation.chunkId`,
          { documentId, relations },
        );
      });
    } finally {
      await session.close();
    }
  }

  async searchRelated(input: GraphSearchInput): Promise<GraphSearchPath[]> {
    if (!input.allowedDocumentIds.length) return [];
    const maxHops = Math.min(Math.max(Math.trunc(input.maxHops), 1), 3);
    const session = this.driver.session();
    try {
      const result = await session.executeRead((transaction) => transaction.run(
        `MATCH (seed:Entity)
         WHERE toLower(seed.name) CONTAINS toLower($query)
           AND EXISTS {
             MATCH (seed)<-[:MENTIONS]-(seedChunk:DocumentChunk)
             WHERE seedChunk.documentId IN $allowedDocumentIds
           }
         MATCH path=(seed)-[:RELATED_TO*1..${maxHops}]-(related:Entity)
         WHERE ALL(relation IN relationships(path)
           WHERE relation.documentId IN $allowedDocumentIds)
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
          limit: neo4j.int(input.limit),
        },
      ));
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
