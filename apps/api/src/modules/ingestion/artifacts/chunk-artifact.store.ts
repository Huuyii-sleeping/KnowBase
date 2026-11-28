import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'node:crypto';
import { CHUNK_ARTIFACT_MODEL } from './artifact.schemas';
import { StructuredChunk } from '../../pipeline/chunk/chunk.types';
import { integerOption } from '../numeric-option';

interface ArtifactRecord {
  documentId: string;
  key: string;
  index: number;
  chunk?: StructuredChunk;
  count?: number;
  digest?: string;
  expiresAt: Date;
}
const digest = (chunks: StructuredChunk[]) =>
  createHash('sha256').update(JSON.stringify(chunks)).digest('hex');

@Injectable()
export class ChunkArtifactStore {
  private readonly retentionMs: number;
  constructor(
    @InjectModel(CHUNK_ARTIFACT_MODEL)
    private readonly model: Model<ArtifactRecord>,
    config: ConfigService,
  ) {
    this.retentionMs =
      integerOption(config, 'INGESTION_CACHE_TTL_DAYS', 30) * 86400000;
  }

  async find(key: string): Promise<StructuredChunk[] | undefined> {
    const records = await this.model
      .find({ key, expiresAt: { $gt: new Date() } })
      .sort({ index: 1 })
      .lean()
      .exec();
    const [manifest, ...parts] = records;
    if (
      manifest?.index !== -1 ||
      manifest.count !== parts.length ||
      parts.some((part, i) => part.index !== i || !part.chunk)
    )
      return undefined;
    const chunks = parts.map((part) => part.chunk!);
    return digest(chunks) === manifest.digest ? chunks : undefined;
  }

  async save(
    documentId: string,
    key: string,
    chunks: StructuredChunk[],
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + this.retentionMs);
    // Publish the manifest last. A partial or expired write is never reusable.
    for (let offset = 0; offset < chunks.length; offset += 200) {
      await this.model.bulkWrite(
        chunks.slice(offset, offset + 200).map((chunk, i) => ({
          updateOne: {
            filter: { key, index: offset + i },
            update: {
              $set: { documentId, key, index: offset + i, chunk, expiresAt },
            },
            upsert: true,
          },
        })),
      );
    }
    await this.model.updateOne(
      { key, index: -1 },
      {
        $set: {
          documentId,
          key,
          index: -1,
          count: chunks.length,
          digest: digest(chunks),
          expiresAt,
        },
      },
      { upsert: true },
    );
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.model.deleteMany({ documentId });
  }
}
