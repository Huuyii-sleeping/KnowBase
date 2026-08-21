import { Inject, Injectable } from '@nestjs/common';
import {
  GraphExtractionProvider,
  GraphExtractionResult,
} from './graph-extractor.types';

export interface GraphExtractionChunk {
  id: string;
  content: string;
}

@Injectable()
export class GraphExtractionService {
  constructor(
    @Inject('GRAPH_EXTRACTION_PROVIDER')
    private readonly provider: GraphExtractionProvider,
  ) {}

  async extract(chunks: GraphExtractionChunk[]): Promise<GraphExtractionResult> {
    const entities = new Map<string, { key: string; name: string; type: string }>();
    const mentions = new Map<string, { chunkId: string; entityKey: string }>();
    const relations = new Map<string, GraphExtractionResult['relations'][number]>();

    for (const chunk of chunks) {
      const extraction = await this.provider.extract(chunk.content);
      const localEntities = new Map<string, string>();

      for (const entity of extraction.entities) {
        const normalizedName = this.normalize(entity.name);
        if (!normalizedName) continue;
        const type = this.cleanType(entity.type);
        const key = this.entityKey(normalizedName, type);
        localEntities.set(normalizedName, key);
        entities.set(key, entities.get(key) ?? { key, name: entity.name.trim(), type });
        mentions.set(`${chunk.id}:${key}`, { chunkId: chunk.id, entityKey: key });
      }

      for (const relation of extraction.relations) {
        const source = this.ensureEntity(relation.source, '未知', localEntities, entities);
        const target = this.ensureEntity(relation.target, '未知', localEntities, entities);
        if (!source || !target || source === target) continue;
        mentions.set(`${chunk.id}:${source}`, { chunkId: chunk.id, entityKey: source });
        mentions.set(`${chunk.id}:${target}`, { chunkId: chunk.id, entityKey: target });

        const type = this.cleanType(relation.type) || '相关';
        const key = `${chunk.id}:${source}:${target}:${this.normalize(type)}`;
        relations.set(key, {
          key,
          source: relation.source.trim(),
          target: relation.target.trim(),
          type,
          sourceKey: source,
          targetKey: target,
          chunkId: chunk.id,
        });
      }
    }

    return {
      entities: [...entities.values()],
      mentions: [...mentions.values()],
      relations: [...relations.values()],
    };
  }

  private ensureEntity(
    name: string,
    type: string,
    localEntities: Map<string, string>,
    entities: Map<string, { key: string; name: string; type: string }>,
  ): string | null {
    const normalizedName = this.normalize(name);
    if (!normalizedName) return null;
    const existing = localEntities.get(normalizedName);
    if (existing) return existing;

    const cleanType = this.cleanType(type) || '未知';
    const key = this.entityKey(normalizedName, cleanType);
    localEntities.set(normalizedName, key);
    entities.set(key, entities.get(key) ?? {
      key,
      name: name.trim(),
      type: cleanType,
    });
    return key;
  }

  private entityKey(name: string, type: string): string {
    return `${this.normalize(type) || '未知'}:${name}`;
  }

  private normalize(value: string): string {
    return typeof value === 'string'
      ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
      : '';
  }

  private cleanType(value: string): string {
    return typeof value === 'string'
      ? value.trim().replace(/\s+/g, ' ').slice(0, 64)
      : '';
  }
}
