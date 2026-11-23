import { Injectable } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { AssetUploadInput, ParsedAsset } from './file-parser.types';
import { OutboxStore } from '../../delivery/outbox.store';
import { MESSAGE_ROUTING_KEYS } from '../../message-queue/message-queue.constants';

@Injectable()
export class AssetUploaderService {
  constructor(
    private readonly storage: StorageService,
    private readonly outbox: OutboxStore,
  ) {}

  async discard(documentId: string, assets: ParsedAsset[]): Promise<void> {
    if (!assets.length) return;
    await this.outbox.enqueueStandalone(MESSAGE_ROUTING_KEYS.ASSETS_DELETE, {
      type: 'DOCUMENT_ASSETS_DELETE',
      documentId,
      keys: [...new Set(assets.map((asset) => asset.objectKey))],
    });
  }

  async upload(
    documentId: string,
    input: AssetUploadInput,
  ): Promise<ParsedAsset> {
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uploaded = await this.storage.putAsset({
      documentId,
      fileName: safeName,
      data: input.data,
      contentType: input.contentType,
    });

    return {
      type: input.type ?? 'attachment',
      objectKey: uploaded.objectKey,
      url: uploaded.url,
      alt: input.alt,
      contentType: input.contentType,
    };
  }
}
