import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { StorageController } from './storage.controller';

function fixture() {
  const storage = {
    statObject: vi.fn(async () => ({
      size: 10,
      metaData: { 'content-type': 'video/mp4' },
    })),
    getObject: vi.fn(async () => Readable.from(['0123456789'])),
    getPartialObject: vi.fn(async () => Readable.from(['234'])),
  };
  const access = { assertCanViewStorageKey: vi.fn() };
  const response = { setHeader: vi.fn(), status: vi.fn(), once: vi.fn() };
  return {
    storage,
    access,
    response,
    controller: new StorageController(storage as any, access as any),
  };
}
describe('authorized object range streaming', () => {
  it('returns a partial stream with seek headers', async () => {
    const f = fixture();
    const result = await f.controller.getObject(
      'key',
      {} as any,
      f.response as any,
      'bytes=2-4',
    );
    expect(f.response.status).toHaveBeenCalledWith(206);
    expect(f.response.setHeader).toHaveBeenCalledWith(
      'Content-Range',
      'bytes 2-4/10',
    );
    expect(f.storage.getPartialObject).toHaveBeenCalledWith('key', 2, 3);
    expect(f.storage.getObject).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
  it('returns 416 without opening an unsatisfiable range and supports full reads', async () => {
    const f = fixture();
    await f.controller.getObject(
      'key',
      {} as any,
      f.response as any,
      'bytes=99-',
    );
    expect(f.response.status).toHaveBeenCalledWith(416);
    expect(f.response.setHeader).toHaveBeenCalledWith(
      'Content-Range',
      'bytes */10',
    );
    expect(f.storage.getObject).not.toHaveBeenCalled();
    await f.controller.getObject('key', {} as any, f.response as any);
    expect(f.storage.getObject).toHaveBeenCalledOnce();
  });
  it('checks access before any object metadata or content is read', async () => {
    const f = fixture();
    f.access.assertCanViewStorageKey.mockRejectedValueOnce(
      new Error('forbidden'),
    );
    await expect(
      f.controller.getObject('key', {} as any, f.response as any, 'bytes=0-'),
    ).rejects.toThrow('forbidden');
    expect(f.storage.statObject).not.toHaveBeenCalled();
  });
});

it('issues object-scoped expiring tickets after checking access', async () => {
  const f = fixture();
  const jwt = { signAsync: vi.fn(async () => 'signed-token') };
  (f.storage as any).getObjectUrl = vi.fn(
    () => '/storage/object?key=key',
  ) as any;
  const controller = new StorageController(
    f.storage as any,
    f.access as any,
    jwt as any,
  );
  expect(
    await controller.accessUrl('key', { id: 'user' } as any, f.response as any),
  ).toEqual({
    url: '/storage/object?key=key&ticket=signed-token',
    expiresInSeconds: 300,
  });
  expect(jwt.signAsync).toHaveBeenCalledWith(
    { sub: 'user', purpose: 'storage_object', key: 'key' },
    { expiresIn: '5m' },
  );
  f.access.assertCanViewStorageKey.mockRejectedValueOnce(
    new Error('forbidden'),
  );
  await expect(
    controller.accessUrl('other', {} as any, f.response as any),
  ).rejects.toThrow('forbidden');
  expect(jwt.signAsync).toHaveBeenCalledOnce();
});
