import { describe, expect, it, vi } from 'vitest';
import { AssetUploaderService } from './asset-uploader.service';

describe('AssetUploaderService', () => {
  it('sanitizes asset names and maps storage results to parser assets', async () => {
    const storage = {
      putAsset: vi.fn(async () => ({
        objectKey: 'assets/document-1/image.png',
        url: '/api/v1/storage/object?key=image',
      })),
    };
    const service = new AssetUploaderService(storage as any);

    const result = await service.upload('document-1', {
      fileName: '会议 image.png',
      data: Buffer.from('image'),
      contentType: 'image/png',
      type: 'image',
      alt: 'meeting image',
    });

    expect(storage.putAsset).toHaveBeenCalledWith(expect.objectContaining({
      documentId: 'document-1',
      fileName: '___image.png',
    }));
    expect(result).toMatchObject({
      type: 'image',
      objectKey: 'assets/document-1/image.png',
      alt: 'meeting image',
    });
  });
});
