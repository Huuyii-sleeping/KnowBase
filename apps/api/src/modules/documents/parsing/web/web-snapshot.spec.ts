import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { publicAddress, webUrl } from './web-url-policy';
import { WebSnapshotParser } from './web-snapshot.parser';
import { WebImportService } from '../../web-import.service';
describe('web snapshot ingestion', () => {
  it('rejects private, link-local and transition networks and non-HTTP targets', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '192.168.2.1',
      '::1',
      'fc00::1',
      '::ffff:127.0.0.1',
      '2002:7f00:1::',
      '2001:db8::1',
    ])
      expect(publicAddress(address)).toBe(false);
    expect(publicAddress('1.1.1.1')).toBe(true);
    expect(publicAddress('2606:4700:4700::1111')).toBe(true);
    for (const url of [
      'file:///etc/passwd',
      'http://user:password@example.com',
      'ftp://example.com',
      'http://example.com:8080',
    ])
      expect(() => webUrl(url)).toThrow();
    expect(webUrl('https://example.com/a#fragment').href).toBe(
      'https://example.com/a',
    );
  });
  it('checks snapshot hash before parsing and preserves capture metadata with explicit static limits', async () => {
    const mineru = {
      parse: vi.fn(async () => ({
        markdown: '正文',
        ready: true,
        assets: [],
        warnings: [],
      })),
    };
    const parser = new WebSnapshotParser(mineru as any);
    const html = '<p>正文</p>',
      hash = createHash('sha256').update(html).digest('hex');
    const snapshot = {
      schema: 'web-snapshot-v1',
      html,
      sha256: hash,
      capturedAt: '2026-11-23T00:00:00Z',
      requestedUrl: 'https://example.com/a',
      finalUrl: 'https://example.com/b',
    };
    const result = await parser.parse(
      Buffer.from(JSON.stringify(snapshot)),
      'snapshot.websnapshot',
      {} as any,
    );
    expect(result.ready).toBe(false);
    expect(result.evidence![0]).toMatchObject({
      kind: 'web_snapshot',
      data: {
        sha256: hash,
        finalUrl: 'https://example.com/b',
        rendering: 'static_html',
      },
    });
    await expect(
      parser.parse(
        Buffer.from(JSON.stringify({ ...snapshot, html: 'changed' })),
        '',
        {} as any,
      ),
    ).rejects.toThrow('integrity');
    expect(mineru.parse).toHaveBeenCalledOnce();
  });
  it('captures before document creation and never persists a failed fetch or bypasses parsing with supplied Markdown', async () => {
    const fetcher = {
      capture: vi.fn(async () => ({
        finalUrl: 'https://example.com/a',
        html: 'original',
      })),
    };
    const commands = { create: vi.fn(async () => 'doc') };
    const importer = new WebImportService(fetcher as any, commands as any);
    await expect(
      importer.create(
        'https://example.com/a',
        { markdown: 'untrusted' },
        {} as any,
      ),
    ).resolves.toEqual({ id: 'doc' });
    expect(commands.create.mock.calls[0][0]).toMatchObject({
      originalname: 'example.com.websnapshot',
      mimetype: 'application/json',
    });
    expect(commands.create.mock.calls[0][1].markdown).toBeUndefined();
    fetcher.capture.mockRejectedValueOnce(new Error('DNS private info'));
    await expect(
      importer.create('http://localhost', {}, {} as any),
    ).rejects.toThrow('网页抓取失败');
    expect(commands.create).toHaveBeenCalledOnce();
  });
});

it('selects main article content and preserves table structure without script or navigation noise', async () => {
  const { staticWebBody } = await import('./static-web-body');
  const result = staticWebBody(
    '<html><body><nav>Menu</nav><main><h1>Budget</h1><script>privateScript()</script><table><tr><td rowspan="2">Research</td><td>100</td></tr></table><a href="https://example.com/detail" onclick="evil()">Details</a></main><footer>Ads</footer></body></html>',
  );
  expect(result.selection).toBe('main');
  expect(result.html).toContain('rowspan="2"');
  expect(result.html).toContain('https://example.com/detail');
  for (const noise of ['Menu', 'privateScript', 'Ads', 'onclick'])
    expect(result.html).not.toContain(noise);
});
