import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));
import { WebSnapshotFetcher } from './web-snapshot.fetcher';
afterEach(() => vi.resetAllMocks());
beforeEach(() =>
  vi
    .mocked(lookup)
    .mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as any),
);
function response(
  body: Buffer,
  headers: Record<string, string> = {
    'content-type': 'text/html; charset=UTF-8',
  },
  code = 200,
) {
  const stream = Object.assign(Readable.from([body]), {
    statusCode: code,
    headers,
  });
  vi.mocked(request).mockImplementationOnce(
    (_url: any, _options: any, callback: any) =>
      Object.assign(new EventEmitter(), {
        end: () => queueMicrotask(() => callback(stream)),
      }) as any,
  );
  return stream;
}
describe('controlled webpage capture', () => {
  it('pins the resolved public address and saves a stable original snapshot hash', async () => {
    response(Buffer.from('<main>正文</main>'));
    const result = await new WebSnapshotFetcher().capture(
      'https://example.com/a',
    );
    expect(result).toMatchObject({
      html: '<main>正文</main>',
      finalUrl: 'https://example.com/a',
    });
    expect(result.sha256).toHaveLength(64);
    const options = vi.mocked(request).mock.calls[0][1] as any;
    const callback = vi.fn();
    options.lookup('example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: '1.1.1.1', family: 4 },
    ]);
    expect(options.headers.Authorization).toBeUndefined();
  });
  it('rejects mixed private DNS and validates every redirect destination before connecting', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([
      { address: '1.1.1.1', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ] as any);
    await expect(
      new WebSnapshotFetcher().capture('https://example.com'),
    ).rejects.toThrow('not public');
    expect(request).not.toHaveBeenCalled();
    response(
      Buffer.from(''),
      { location: 'https://internal.example/path' },
      302,
    );
    vi.mocked(lookup)
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }] as any)
      .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }] as any);
    await expect(
      new WebSnapshotFetcher().capture('https://example.com'),
    ).rejects.toThrow('not public');
    expect(request).toHaveBeenCalledOnce();
  });
  it('rejects unsupported responses, oversized bodies and invalid UTF-8', async () => {
    response(Buffer.from('pdf'), { 'content-type': 'application/pdf' });
    await expect(
      new WebSnapshotFetcher().capture('https://example.com'),
    ).rejects.toThrow('UTF-8 HTML');
    response(Buffer.alloc(5 * 1024 * 1024 + 1));
    await expect(
      new WebSnapshotFetcher().capture('https://example.com'),
    ).rejects.toThrow('budget');
    response(Buffer.from([0xff]));
    await expect(
      new WebSnapshotFetcher().capture('https://example.com'),
    ).rejects.toThrow();
  });
});
