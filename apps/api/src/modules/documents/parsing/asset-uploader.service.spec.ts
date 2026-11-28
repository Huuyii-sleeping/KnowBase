import { describe, expect, it, vi } from 'vitest';
import { AssetUploaderService } from './asset-uploader.service';

describe('AssetUploaderService', () => {
  it('persists an idempotently removable asset cleanup task before returning', async () => {
    const outbox = { enqueueStandalone: vi.fn() };
    const service = new AssetUploaderService({} as any, outbox as any);
    const asset = {
      type: 'image' as const,
      objectKey: 'assets/doc/attempt-image',
      url: '/image',
    };
    await service.discard('doc', [asset, asset]);
    expect(outbox.enqueueStandalone).toHaveBeenCalledWith(
      'document.assets.delete',
      {
        type: 'DOCUMENT_ASSETS_DELETE',
        documentId: 'doc',
        keys: ['assets/doc/attempt-image'],
      },
    );
    outbox.enqueueStandalone.mockRejectedValueOnce(
      new Error('database offline'),
    );
    await expect(service.discard('doc', [asset])).rejects.toThrow(
      'database offline',
    );
  });

  it('sanitizes asset names and maps storage results to parser assets', async () => {
    const storage = {
      putAsset: vi.fn(async () => ({
        objectKey: 'assets/document-1/image.png',
        url: '/api/v1/storage/object?key=image',
      })),
    };
    const service = new AssetUploaderService(
      storage as any,
      { enqueueStandalone: vi.fn() } as any,
    );

    const result = await service.upload('document-1', {
      fileName: '会议 image.png',
      data: Buffer.from('image'),
      contentType: 'image/png',
      type: 'image',
      alt: 'meeting image',
    });

    expect(storage.putAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'document-1',
        fileName: '___image.png',
      }),
    );
    expect(result).toMatchObject({
      type: 'image',
      objectKey: 'assets/document-1/image.png',
      alt: 'meeting image',
    });
  });
});
