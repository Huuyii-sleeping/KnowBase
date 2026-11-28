import { describe, expect, it, vi } from 'vitest';
import { DocumentArtifactVerifier } from './document-artifact-verifier';
it('checks new asset metadata and skips legacy records without integrity metadata', async () => {
  const storage = {
    statObject: vi.fn(async () => ({
      size: 5,
      metaData: { sha256: 'digest', 'content-type': 'image/png' },
    })),
  };
  const verifier = new DocumentArtifactVerifier(storage as any);
  await expect(
    verifier.verify([
      {
        objectKey: 'key',
        bytes: 5,
        sha256: 'digest',
        contentType: 'image/png',
      },
      { objectKey: 'old' },
    ]),
  ).resolves.toBeUndefined();
  expect(storage.statObject).toHaveBeenCalledOnce();
  await expect(
    verifier.verify([
      {
        objectKey: 'key',
        bytes: 4,
        sha256: 'digest',
        contentType: 'image/png',
      },
    ]),
  ).rejects.toThrow('manifest');
});
it('distinguishes missing assets from a transient storage outage', async () => {
  const storage = {
    statObject: vi
      .fn()
      .mockRejectedValueOnce({ code: 'NoSuchKey' })
      .mockRejectedValueOnce(new Error('offline')),
  };
  const verifier = new DocumentArtifactVerifier(storage as any);
  const assets = [{ objectKey: 'key', bytes: 5, sha256: 'digest' }];
  await expect(verifier.verify(assets)).rejects.toThrow('missing');
  await expect(verifier.verify(assets)).rejects.toThrow('offline');
});
