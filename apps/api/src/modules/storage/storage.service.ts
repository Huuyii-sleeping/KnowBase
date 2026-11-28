import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { createHash, randomUUID } from 'node:crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ASSET_REGISTRY_MODEL,
  StoredDocumentAsset,
} from './asset-registry.schema';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Client;
  private readonly bucket: string;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @InjectModel(ASSET_REGISTRY_MODEL)
    private readonly assets?: Model<StoredDocumentAsset>,
  ) {
    this.bucket = this.config.get<string>(
      'RUSTFS_BUCKET',
      'knowbase-documents',
    );
    this.client = new Client({
      endPoint: this.config.getOrThrow<string>('RUSTFS_ENDPOINT'),
      port: this.config.get<number>('RUSTFS_PORT', 9000),
      useSSL: this.getBoolean('RUSTFS_USE_SSL', false),
      accessKey: this.config.getOrThrow<string>('RUSTFS_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('RUSTFS_SECRET_KEY'),
    });
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket, 'us-east-1');
      this.logger.log(`Created object storage bucket: ${this.bucket}`);
    }
  }

  async putObject(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.ensureBucket();
    await this.client.putObject(this.bucket, key, data, data.length, {
      'Content-Type': contentType,
      'X-Amz-Meta-Sha256': createHash('sha256').update(data).digest('hex'),
    });
  }

  async putAsset(input: {
    documentId: string;
    fileName: string;
    data: Buffer;
    contentType: string;
  }): Promise<{ objectKey: string; url: string }> {
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `assets/${input.documentId}/${randomUUID()}-${safeName}`;
    // Reserve ownership before writing bytes so a process crash cannot orphan
    // an object with no discoverable document association.
    await this.assets?.create({
      objectKey,
      documentId: input.documentId,
      contentType: input.contentType,
      bytes: input.data.length,
      sha256: createHash('sha256').update(input.data).digest('hex'),
    });
    await this.putObject(objectKey, input.data, input.contentType);
    return { objectKey, url: this.getObjectUrl(objectKey) };
  }

  async removeObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
    await this.assets?.deleteOne({ objectKey: key });
  }

  async assetKeys(documentId: string): Promise<string[]> {
    return this.assets
      ? this.assets.distinct('objectKey', { documentId }).exec()
      : [];
  }

  async orphanCandidates(after?: string) {
    return this.assets
      ? this.assets
          .find({
            createdAt: { $lt: new Date(Date.now() - 86400000) },
            ...(after ? { objectKey: { $gt: after } } : {}),
          })
          .sort({ objectKey: 1 })
          .limit(100)
          .lean()
          .exec()
      : [];
  }

  async getObject(key: string) {
    return this.client.getObject(this.bucket, key);
  }

  async getPartialObject(key: string, start: number, length: number) {
    return this.client.getPartialObject(this.bucket, key, start, length);
  }

  async statObject(key: string) {
    return this.client.statObject(this.bucket, key);
  }

  getObjectUrl(key: string): string {
    const baseUrl = this.config.get<string>(
      'PUBLIC_API_BASE_URL',
      'http://localhost:3000/api/v1',
    );
    return `${baseUrl}/storage/object?key=${encodeURIComponent(key)}`;
  }

  private getBoolean(key: string, fallback: boolean): boolean {
    const value = this.config.get<string>(key);
    if (value === undefined) {
      return fallback;
    }
    return value.toLowerCase() === 'true';
  }
}
