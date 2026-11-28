import { describe, expect, it, vi } from 'vitest';
import { DocumentAssetsCleanupService } from './document-assets-cleanup.service';
describe('asset cleanup', () => {
  it('removes only unique keys in the attempt document scope and propagates failures', async () => {
    const storage = { removeObject: vi.fn().mockResolvedValue(undefined) };
    const service = new DocumentAssetsCleanupService(storage as any);
    await service.cleanup('doc', ['assets/doc/a..png', 'assets/doc/a..png']);
    expect(storage.removeObject).toHaveBeenCalledTimes(1);
    storage.removeObject.mockRejectedValueOnce(new Error('offline'));
    await expect(service.cleanup('doc', ['assets/doc/b.png'])).rejects.toThrow(
      'offline',
    );
  });
  it.each(['original/doc/a', 'assets/other/a', 'assets/doc/../a'])(
    'rejects keys outside its scope (%s)',
    async (key) => {
      const storage = { removeObject: vi.fn() };
      await expect(
        new DocumentAssetsCleanupService(storage as any).cleanup('doc', [key]),
      ).rejects.toThrow('scope');
      expect(storage.removeObject).not.toHaveBeenCalled();
    },
  );
});
