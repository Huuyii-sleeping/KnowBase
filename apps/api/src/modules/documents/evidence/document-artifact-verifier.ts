import { Injectable } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { ParsedAsset } from '../parsing/file-parser.types';
@Injectable()
export class DocumentArtifactVerifier {
  constructor(private readonly storage: StorageService) {}
  async verify(
    assets: Pick<
      ParsedAsset,
      'objectKey' | 'bytes' | 'sha256' | 'contentType'
    >[],
  ): Promise<void> {
    for (const asset of assets) {
      // Old content has no digest metadata; new content requires exact metadata.
      if (!asset.sha256 || asset.bytes === undefined) continue;
      const stat = await this.storage
        .statObject(asset.objectKey)
        .catch((error: { code?: string }) => {
          if (
            ['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(error.code ?? '')
          )
            throw new Error('Document asset missing');
          throw error;
        });
      if (
        stat.size !== asset.bytes ||
        stat.metaData.sha256 !== asset.sha256 ||
        stat.metaData['content-type'] !== asset.contentType
      )
        throw new Error('Document asset manifest does not match stored object');
    }
  }
}
