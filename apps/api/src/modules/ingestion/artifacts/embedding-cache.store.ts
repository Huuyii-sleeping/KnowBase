import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { EMBEDDING_CACHE_MODEL } from './artifact.schemas';
import { integerOption } from '../numeric-option';

interface CachedEmbedding {
  documentId: string;
  key: string;
  vector: number[];
  expiresAt: Date;
}

@Injectable()
export class EmbeddingCacheStore {
  private readonly retentionMs: number;
  constructor(
    @InjectModel(EMBEDDING_CACHE_MODEL)
    private readonly model: Model<CachedEmbedding>,
    config: ConfigService,
  ) {
    this.retentionMs =
      integerOption(config, 'INGESTION_CACHE_TTL_DAYS', 30) * 86400000;
  }

  async find(keys: string[]): Promise<Map<string, number[]>> {
    const found = new Map<string, number[]>();
    for (let offset = 0; offset < keys.length; offset += 200) {
      const records = await this.model
        .find({
          key: { $in: keys.slice(offset, offset + 200) },
          expiresAt: { $gt: new Date() },
        })
        .lean()
        .exec();
      for (const record of records) found.set(record.key, record.vector);
    }
    return found;
  }

  async save(
    documentId: string,
    entries: Array<{ key: string; vector: number[] }>,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + this.retentionMs);
    for (let offset = 0; offset < entries.length; offset += 200) {
      await this.model.bulkWrite(
        entries.slice(offset, offset + 200).map((entry) => ({
          updateOne: {
            filter: { key: entry.key },
            update: { $set: { ...entry, documentId, expiresAt } },
            upsert: true,
          },
        })),
      );
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.model.deleteMany({ documentId });
  }
}
