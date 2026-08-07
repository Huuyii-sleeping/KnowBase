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
  ): Promise<void> {
    const session = this.driver.session();
    try {
      await session.executeWrite(async (transaction) => {
        await transaction.run(
          'MERGE (d:Document {id: $documentId}) SET d.version = $version',
          { documentId, version: neo4j.int(version) },
        );
        await transaction.run(
          'MATCH (c:DocumentChunk {documentId: $documentId}) DETACH DELETE c',
          { documentId },
        );
        for (const chunk of chunks) {
          await transaction.run(
            `MATCH (d:Document {id: $documentId})
             CREATE (c:DocumentChunk {
               id: $id,
               documentId: $documentId,
               version: $version,
               chunkIndex: $chunkIndex,
               content: $content
             })
             CREATE (d)-[:HAS_CHUNK]->(c)`,
            {
              id: chunk.id,
              documentId,
              version: neo4j.int(chunk.version),
              chunkIndex: neo4j.int(chunk.chunkIndex),
              content: chunk.content,
            },
          );
        }
      });
    } finally {
      await session.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver.close();
  }
}
