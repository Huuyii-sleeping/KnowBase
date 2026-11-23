import { describe, expect, it, vi } from 'vitest';
import { mineruImages } from './mineru-images';

function context() {
  return {
    documentId: 'doc',
    uploadAsset: vi.fn(async (input) => ({
      type: input.type,
      objectKey: 'assets/doc/image',
      url: '/asset/image',
    })),
  };
}

describe('MinerU image assets', () => {
  it('uploads packaged assets and rewrites Markdown and HTML references', async () => {
    const ctx = context();
    const images = await mineruImages(
      new Map([['images/photo.webp', Buffer.from('image')]]),
      ctx,
      false,
    );
    expect(ctx.uploadAsset).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/webp', type: 'image' }),
    );
    expect(
      images.rewrite('![图](images/photo.webp) <img src="images/photo.webp">'),
    ).toBe('![图](/asset/image) ![](/asset/image)');
    expect(images.assets).toHaveLength(1);
    expect(images.issues).toEqual([]);
  });

  it('marks HTML remote and missing relative images for review without fetching or rendering their URLs', async () => {
    const ctx = context();
    const images = await mineruImages(new Map(), ctx, true);
    for (const source of [
      'https://example.com/tracker.png',
      '//example.com/img.png',
      'missing.png',
    ]) {
      const rewritten = images.rewrite(`![图](${source})`);
      expect(rewritten).toContain('网页图片未导入');
      expect(rewritten).not.toContain(source);
      images.render(source);
    }
    expect(images.issues).toHaveLength(3);
    expect(ctx.uploadAsset).not.toHaveBeenCalled();
  });

  it('rejects missing packaged references and unsafe image schemes for every format', async () => {
    for (const html of [true, false]) {
      const images = await mineruImages(new Map(), context(), html);
      for (const source of [
        'images/missing.png',
        'javascript:alert(1)',
        'file:///tmp/private',
        '',
      ])
        expect(() => images.render(source)).toThrow();
      if (!html)
        expect(() => images.render('https://example.com/image.png')).toThrow(
          'external',
        );
    }
    await expect(
      mineruImages(
        new Map([['images/unsafe.svg', Buffer.from('<svg/>')]]),
        context(),
        true,
      ),
    ).rejects.toThrow('image type');
  });

  it('propagates failed asset persistence for the existing parse cleanup workflow', async () => {
    const ctx = context();
    ctx.uploadAsset.mockRejectedValue(new Error('storage unavailable'));
    await expect(
      mineruImages(
        new Map([['images/photo.png', Buffer.from('image')]]),
        ctx,
        false,
      ),
    ).rejects.toThrow('storage unavailable');
  });
});
