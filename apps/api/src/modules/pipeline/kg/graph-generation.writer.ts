import neo4j, { type Driver, type ManagedTransaction } from 'neo4j-driver';
import type {
  KnowledgeChunkInput,
  KnowledgeEntityInput,
} from './graph-extractor.types';
import type { GraphMentionInput } from './graph-index.service';

export class GraphGenerationWriter {
  private schema?: Promise<void>;
  constructor(private readonly driver: Driver) {}

  async stageDocument(
    documentId: string,
    version: number,
    generation: string,
    chunks: KnowledgeChunkInput[],
    entities: KnowledgeEntityInput[] = [],
    mentions: GraphMentionInput[] = [],
    relations: Array<{
      key: string;
      sourceKey: string;
      targetKey: string;
      type: string;
      chunkId: string;
    }> = [],
  ): Promise<void> {
    await this.ensureSchema();
    const session = this.driver.session();
    try {
      await session.executeWrite(async (transaction) => {
        await transaction.run(
          `MERGE (d:KnowledgeDocument {id: $documentId, generationId: $generation})
           SET d.version = $version`,
          { documentId, generation, version: neo4j.int(version) },
        );
        await transaction.run(
          `UNWIND $chunks AS chunk
           MATCH (d:KnowledgeDocument {id: $documentId, generationId: $generation})
           CREATE (c:DocumentChunk {
             id: chunk.id,
             documentId: $documentId,
             generationId: $generation,
             version: chunk.version,
             chunkIndex: chunk.chunkIndex,
             content: chunk.content
           })
           CREATE (d)-[:HAS_CHUNK]->(c)`,
          {
            documentId,
            generation,
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
           MERGE (e:KnowledgeEntity {key: entity.key})
           ON CREATE SET e.name = entity.name, e.type = entity.type`,
          { entities },
        );
        await transaction.run(
          `UNWIND $mentions AS mention
           MATCH (c:DocumentChunk {id: mention.chunkId})
           MATCH (e:KnowledgeEntity {key: mention.entityKey})
           MERGE (c)-[:MENTIONS]->(e)`,
          { mentions },
        );
        await transaction.run(
          `UNWIND $relations AS relation
           MATCH (source:KnowledgeEntity {key: relation.sourceKey})
           MATCH (target:KnowledgeEntity {key: relation.targetKey})
           MERGE (source)-[r:RELATED_TO {key: relation.key, generationId: $generation}]->(target)
           SET r.type = relation.type,
               r.documentId = $documentId,
               r.chunkId = relation.chunkId`,
          { documentId, generation, relations },
        );
      });
    } finally {
      await session.close();
    }
  }

  async remove(documentId: string, generation?: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.executeWrite((transaction) =>
        this.clearDocumentGraph(transaction, documentId, generation),
      );
    } finally {
      await session.close();
    }
  }

  private async clearDocumentGraph(
    transaction: ManagedTransaction,
    documentId: string,
    generation?: string,
  ): Promise<void> {
    await transaction.run(
      `MATCH ()-[r:RELATED_TO {documentId: $documentId}]-()
       ${generation ? 'WHERE r.generationId = $generation' : ''}
       DELETE r`,
      generation ? { documentId, generation } : { documentId },
    );
    await transaction.run(
      `MATCH (c:DocumentChunk {documentId: $documentId})
       ${generation ? 'WHERE c.generationId = $generation' : ''}
       DETACH DELETE c`,
      generation ? { documentId, generation } : { documentId },
    );
    await transaction.run(
      `MATCH (d:KnowledgeDocument {id: $documentId})
       ${generation ? 'WHERE d.generationId = $generation' : ''}
       DETACH DELETE d`,
      generation ? { documentId, generation } : { documentId },
    );
    await transaction.run(
      `MATCH (entity:KnowledgeEntity)
       WHERE NOT (entity)<-[:MENTIONS]-(:DocumentChunk)
         AND NOT (entity)-[:RELATED_TO]-(:KnowledgeEntity)
       DETACH DELETE entity`,
    );
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schema) {
      this.schema = (async () => {
        const session = this.driver.session();
        try {
          await session.run(
            'CREATE CONSTRAINT kh_entity_key IF NOT EXISTS FOR (e:KnowledgeEntity) REQUIRE e.key IS UNIQUE',
          );
          await session.run(
            'CREATE CONSTRAINT kh_chunk_id IF NOT EXISTS FOR (c:DocumentChunk) REQUIRE c.id IS UNIQUE',
          );
          await session.run(
            'CREATE CONSTRAINT kh_document_generation IF NOT EXISTS FOR (d:KnowledgeDocument) REQUIRE (d.id, d.generationId) IS UNIQUE',
          );
        } finally {
          await session.close();
        }
      })().catch((error) => {
        this.schema = undefined;
        throw error;
      });
    }
    await this.schema;
  }
}
