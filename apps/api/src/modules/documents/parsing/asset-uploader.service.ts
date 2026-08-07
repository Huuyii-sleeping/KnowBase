import { Injectable } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { AssetUploadInput, ParsedAsset } from './file-parser.types';

@Injectable()
export class AssetUploaderService {
  constructor(private readonly storage: StorageService) {}

  async upload(documentId: string, input: AssetUploadInput): Promise<ParsedAsset> {
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
