import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('RUSTFS_BUCKET', 'knowbase-documents');
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

  async putObject(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.putObject(this.bucket, key, data, data.length, {
      'Content-Type': contentType,
    });
  }

  async removeObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  private getBoolean(key: string, fallback: boolean): boolean {
    const value = this.config.get<string>(key);
    if (value === undefined) {
      return fallback;
    }
    return value.toLowerCase() === 'true';
  }
}
