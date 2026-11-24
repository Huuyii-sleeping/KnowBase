import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import JSZip from 'jszip';
import { MineruParser } from './mineru.parser';
import { mineruArchive } from './mineru-archive';
import { mineruResult } from './mineru-result';
import { mineruOptions } from './mineru-options';

function payload(overrides: Record<string, unknown> = {}) {
  const structure = {
    is_full_document: true,
    metadata: { producer: { name: 'mineru', version: '4.2.3' } },
    extensions: { mineru: { tier: 'standard', parse_mode: 'ocr' } },
    pages: [
      {
        page_idx: 0,
        blocks: [
          { type: 'paragraph_title', level: 1, content: '发布指南' },
          { type: 'text', content: '审核通过后发布。', bbox: [0, 0, 1, 1] },
          {
            type: 'table',
            content: '| 项目 | 金额 |\n| --- | --- |\n| 索引 | 100 |',
            captions: [{ content: '成本表' }],
          },
          {
            type: 'image',
            content: '',
            image_source: 'images/page_0_image_1.png',
          },
        ],
      },
    ],
    ...overrides,
  };
  return new Map([
    ['structured_content.json', Buffer.from(JSON.stringify(structure))],
    [
      'middle_json.json',
      Buffer.from(
        JSON.stringify({
          schema: 'docvortex.middle',
          schema_version: '2.0',
          ...structure,
        }),
      ),
    ],
    ['markdown.md', Buffer.from('# 原始 Markdown')],
    ['images/page_0_image_1.png', Buffer.from('image')],
  ]);
}
async function archive(files = payload()) {
  const zip = new JSZip();
  for (const [name, bytes] of files) zip.file(name, bytes);
  return zip.generateAsync({ type: 'nodebuffer' });
}
function context() {
  const uploadAsset = vi.fn(async (input) => ({
    type: input.type,
    objectKey: `assets/doc/${input.fileName}`,
    url: `/asset/${input.fileName}`,
  }));
  return { documentId: 'doc', uploadAsset };
}
afterEach(() => vi.unstubAllGlobals());

describe('MinerU v4 adapter', () => {
  it('uses an immediately preceding numbered table title for continuation without relabeling the source page', async () => {
    const result = await mineruResult(
      payload({
        pages: [
          {
            page_idx: 0,
            blocks: [
              {
                type: 'paragraph_title',
                content: 'Table 7. Revised settlement',
              },
              {
                type: 'table',
                content:
                  '| Stage | Amount | Status |\n| --- | --- | --- |\n| Advance | 175000 | Cleared |',
              },
            ],
          },
          {
            page_idx: 1,
            blocks: [
              {
                type: 'paragraph_title',
                content: 'Table 7. Revised settlement (continued)',
              },
              {
                type: 'table',
                content:
                  '| Handover | 250000 | Not cleared |\n| --- | --- | --- |\n| Adjustment | -3500 | Recorded |',
              },
            ],
          },
        ],
      }),
      'continued.pdf',
      context(),
      10,
    );
    expect(result.blocks?.filter((block) => block.table).at(-1)).toMatchObject({
      source: { page: 2, tableHeaderPage: 1 },
      table: { rowCount: 3 },
    });
    expect(result.markdown).toContain('| Handover | 250000 | Not cleared |');
    expect(result.ready).toBe(false);
    expect(
      result.quality?.issues.some(
        (issue) => issue.code === 'PDF_TABLE_HEADER_CARRIED',
      ),
    ).toBe(true);
  });
  it.each(['old.doc', 'old.xls', 'old.ppt', 'page.html', 'page.htm'])(
    'uses Flash for %s even when PDF tier is advanced',
    async (fileName) => {
      const bytes = await archive();
      const fetcher = vi.fn(async (url) =>
        String(url).endsWith('/content')
          ? new Response(new Uint8Array(bytes))
          : Response.json({
              task_id: 'task',
              files: [
                { status: 'completed', result_url: 'http://mineru/content' },
              ],
            }),
      );
      vi.stubGlobal('fetch', fetcher);
      await new MineruParser(
        new ConfigService({
          MINERU_BASE_URL: 'http://mineru',
          MINERU_TIER: 'advanced',
        }),
      ).parse(Buffer.from('fixture'), fileName, context());
      expect(JSON.parse(fetcher.mock.calls[0][1].body).tier).toBe('flash');
    },
  );

  it('keeps HTML text with a visible review issue for non-embedded images', async () => {
    const files = payload({
      pages: [
        {
          page_idx: 0,
          blocks: [
            { type: 'text', content: '审核通过后发布。' },
            { type: 'image', image_source: 'https://example.com/image.png' },
          ],
        },
      ],
    });
    const result = await mineruResult(files, 'page.html', context(), 10);
    expect(result.markdown).toContain('审核通过后发布。');
    expect(result.markdown).toContain('网页图片未导入');
    expect(result.markdown).not.toContain('https://example.com');
    expect(result.ready).toBe(false);
    expect(result.quality?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'HTML_IMAGE_NOT_IMPORTED' }),
      ]),
    );
    expect(result.parseStrategy).toContain('adapter-v2');
  });

  it('defaults to the local Flash service and validates explicit service configuration', () => {
    expect(mineruOptions(new ConfigService())).toMatchObject({
      base: 'http://127.0.0.1:8000',
      tier: 'flash',
    });
    expect(() =>
      mineruOptions(new ConfigService({ MINERU_BASE_URL: '' })),
    ).toThrow('MINERU_BASE_URL');
    expect(() =>
      mineruOptions(
        new ConfigService({ MINERU_BASE_URL: 'file:///tmp/service' }),
      ),
    ).toThrow('MINERU_BASE_URL');
  });

  it('submits bytes, persists task before upload, and normalizes the completed ZIP', async () => {
    const bytes = await archive();
    const calls: string[] = [];
    const fetcher = vi.fn(async (url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      if (String(url).endsWith('/v1/tasks'))
        return Response.json({
          task_id: 'task',
          files: [
            {
              status: 'waiting-file',
              upload: { url: 'http://mineru/upload', headers: {} },
            },
          ],
        });
      if (String(url).endsWith('/upload')) return Response.json({});
      if (String(url).endsWith('/content'))
        return new Response(new Uint8Array(bytes));
      return Response.json({
        files: [{ status: 'completed', result_url: 'http://mineru/content' }],
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const ctx = context();
    const result = await new MineruParser(
      new ConfigService({
        MINERU_BASE_URL: 'http://mineru',
        MINERU_API_KEY: 'secret',
      }),
    ).parse(Buffer.from('pdf'), 'file.pdf', {
      ...ctx,
      execution: {
        onRemoteTask: async (id) => {
          calls.push(`saved ${id}`);
        },
      },
    });
    expect(calls.slice(0, 3)).toEqual([
      'POST http://mineru/v1/tasks',
      'saved task',
      'PUT http://mineru/upload',
    ]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).files[0].bytes).toBe(3);
    expect(result).toMatchObject({
      ready: true,
      provenance: { version: '4.2.3', mode: 'ocr' },
    });
    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'image',
        source: expect.objectContaining({ page: 1, blockIndex: 3 }),
        objectKeys: ['assets/doc/images-page_0_image_1.png'],
        data: expect.objectContaining({
          semanticAnalysis: 'not_requested',
          imageAvailable: true,
        }),
      }),
    ]);
    expect(result.markdown).toContain('| 索引 | 100 |');
    expect(result.markdown).toContain('/asset/images-page_0_image_1.png');
    expect(
      result.blocks?.find((block) => block.text === '审核通过后发布。'),
    ).toMatchObject({
      headingPath: ['发布指南'],
      source: { page: 1, blockIndex: 1 },
    });
    expect(ctx.uploadAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'attachment',
        contentType: 'application/json',
      }),
    );
  });

  it('resumes a persisted task and never resubmits an already uploaded file', async () => {
    const bytes = await archive();
    const fetcher = vi.fn(async (url) =>
      String(url).endsWith('/content')
        ? new Response(new Uint8Array(bytes))
        : Response.json({
            files: [
              { status: 'completed', result_url: 'http://mineru/content' },
            ],
          }),
    );
    vi.stubGlobal('fetch', fetcher);
    await new MineruParser(
      new ConfigService({ MINERU_BASE_URL: 'http://mineru' }),
    ).parse(Buffer.from('file'), 'x.docx', {
      ...context(),
      execution: { remoteTaskId: 'existing' },
    });
    expect(
      fetcher.mock.calls.every(
        (call) =>
          String(call[0]).includes('/existing') ||
          String(call[0]).endsWith('/content'),
      ),
    ).toBe(true);
  });

  it('marks incomplete, blank and image-only-equation pages for review', async () => {
    const result = await mineruResult(
      payload({
        is_full_document: false,
        pages: [
          { page_idx: 0, blocks: [{ type: 'text', content: '正文' }] },
          {
            page_idx: 2,
            blocks: [
              {
                type: 'equation',
                content: '',
                image_source: 'images/page_0_image_1.png',
              },
            ],
          },
        ],
      }),
      'scan.pdf',
      context(),
      100,
    );
    expect(result.ready).toBe(false);
    expect(result.quality?.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'PARTIAL_DOCUMENT',
        'NO_PAGE_TEXT',
        'IMAGE_ONLY_EQUATION',
        'MISSING_PAGE',
      ]),
    );
  });

  it('does not invent Word page numbers or Excel worksheet names', async () => {
    const result = await mineruResult(payload(), 'sheet.xlsx', context(), 10);
    expect(
      result.sections?.every(
        (section) =>
          section.source.page === undefined &&
          section.source.sheet === undefined,
      ),
    ).toBe(true);
  });

  it('does not leak authorization to an explicitly allowed result host', async () => {
    const bytes = await archive();
    const fetcher = vi.fn(async (url) =>
      String(url).startsWith('https://results.example')
        ? new Response(new Uint8Array(bytes))
        : Response.json({
            files: [
              {
                status: 'completed',
                result_url: 'https://results.example/content',
              },
            ],
          }),
    );
    vi.stubGlobal('fetch', fetcher);
    await new MineruParser(
      new ConfigService({
        MINERU_BASE_URL: 'http://mineru',
        MINERU_API_KEY: 'secret',
        MINERU_TRANSFER_ORIGINS: 'https://results.example',
      }),
    ).parse(Buffer.from('file'), 'x.pdf', {
      ...context(),
      execution: { remoteTaskId: 'known' },
    });
    const last = fetcher.mock.calls.at(-1)!;
    expect(new Headers(last[1].headers).has('authorization')).toBe(false);
  });

  it('rejects unapproved origins, terminal failures and byte overruns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          files: [
            { status: 'completed', result_url: 'http://unapproved/content' },
          ],
        }),
      ),
    );
    const parser = new MineruParser(
      new ConfigService({ MINERU_BASE_URL: 'http://mineru' }),
    );
    await expect(
      parser.parse(Buffer.from('x'), 'x.pdf', {
        ...context(),
        execution: { remoteTaskId: 'task' },
      }),
    ).rejects.toThrow('origin');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          files: [{ status: 'failed', error: { message: 'private secret' } }],
        }),
      ),
    );
    await expect(
      parser.parse(Buffer.from('x'), 'x.pdf', {
        ...context(),
        execution: { remoteTaskId: 'task' },
      }),
    ).rejects.toThrow('MinerU task failed');
    await expect(mineruArchive(await archive(), 10)).rejects.toThrow('budget');
    const unsafe = new JSZip();
    unsafe.file('../escape', 'x');
    await expect(
      mineruArchive(await unsafe.generateAsync({ type: 'nodebuffer' }), 10000),
    ).rejects.toThrow('Unsafe');
    await expect(
      mineruResult(payload({ pages: [] }), 'x.pdf', context(), 10),
    ).rejects.toThrow('structure');
    expect(() =>
      mineruOptions(new ConfigService({ MINERU_TIER: 'wrong' })),
    ).toThrow('MINERU_TIER');
  });
});
