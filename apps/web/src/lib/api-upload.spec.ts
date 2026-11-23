// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentsApi } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('document upload API boundary', () => {
  it('prevents unsupported files even when called without the upload dialog', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      documentsApi.create(new File(['movie'], 'movie.mp4'), {}),
    ).rejects.toMatchObject({ code: 'FILE_UNSUPPORTED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'report.pdf',
    'old.doc',
    'old.xls',
    'old.ppt',
    'page.html',
    'page.htm',
    'photo.png',
  ])('sends %s once and preserves returned parsing status', async (name) => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'saved', parseStatus: 'FAILED' }), {
        status: 201,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const file = new File(['damaged file'], name);
    const result = await documentsApi.create(file, {
      title: 'Report',
      tags: ['a', 'b'],
    });
    expect(result).toEqual({ id: 'saved', parseStatus: 'FAILED' });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/documents');
    expect(init.method).toBe('POST');
    expect(init.body.get('file').name).toBe(name);
    expect(init.body.get('title')).toBe('Report');
    expect(init.body.get('tags')).toBe('a,b');
  });

  it('never retries a timed out POST', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new DOMException('private host', 'TimeoutError'));
    vi.stubGlobal('fetch', fetch);
    await expect(
      documentsApi.create(new File(['hello'], 'a.txt'), {}),
    ).rejects.toMatchObject({ code: 'REQUEST_INTERRUPTED' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([null, {}, { id: '' }, { id: 3 }])(
    'does not treat an unrecognizable successful response as a confirmed creation',
    async (body) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body), { status: 201 }));
      vi.stubGlobal('fetch', fetch);
      await expect(
        documentsApi.create(new File(['hello'], 'a.txt'), {}),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', kind: 'response' });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
});
