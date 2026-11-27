// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { documentsApi } from '@/lib/api';
import { DocumentBody } from './document-body';
import type { DocumentContent } from '@/lib/api';
vi.mock('@/lib/api', () => ({ documentsApi: { resourceAccess: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const html =
  '<table><caption>复检</caption><tr><th>设备</th><th>偏差（mm）</th></tr><tr><td>丁</td><td>-8.75</td></tr><tr><td>己</td><td></td></tr></table>';
const content = (): DocumentContent => ({
  contentId: 'body',
  markdown: '# 标题\n\n' + html + '\n\n后文',
  parser: 'mineru',
  version: 2,
  warnings: [],
  assets: [],
  characterCount: html.length,
  tables: [
    {
      schema: 'table-v1',
      id: 'table',
      format: 'html',
      start: 6,
      end: 6 + html.length,
      rowCount: 3,
      columnCount: 2,
      headerRows: [1],
      caption: '复检',
      source: { page: 1 },
      cells: [
        {
          row: 1,
          column: 1,
          rowSpan: 1,
          columnSpan: 1,
          text: '设备',
          header: true,
        },
        {
          row: 1,
          column: 2,
          rowSpan: 1,
          columnSpan: 1,
          text: '偏差（mm）',
          header: true,
        },
        {
          row: 2,
          column: 1,
          rowSpan: 1,
          columnSpan: 1,
          text: '丁',
          header: false,
        },
        {
          row: 2,
          column: 2,
          rowSpan: 1,
          columnSpan: 1,
          text: '-8.75',
          header: false,
        },
        {
          row: 3,
          column: 1,
          rowSpan: 1,
          columnSpan: 1,
          text: '己',
          header: false,
        },
        {
          row: 3,
          column: 2,
          rowSpan: 1,
          columnSpan: 1,
          text: '',
          header: false,
        },
      ],
    },
  ],
});
describe('document body evidence rendering', () => {
  it('shows persisted HTML table cells and empty values between surrounding Markdown', () => {
    render(<DocumentBody content={content()} />);
    expect(screen.getByRole('heading', { name: '标题' })).toBeDefined();
    const table = screen.getByRole('table');
    expect(table.querySelector('caption')?.textContent).toBe('复检');
    expect(
      screen.getByRole('columnheader', { name: '偏差（mm）' }),
    ).toBeDefined();
    expect(table.querySelectorAll('tr')[2].children[1].textContent).toBe('');
    expect(screen.getByRole('cell', { name: '-8.75' })).toBeDefined();
    expect(screen.getByText('后文')).toBeDefined();
  });
  it('renders merged spans and treats extracted HTML-looking cell text as text', () => {
    const input = content();
    input.tables![0].cells[2].rowSpan = 2;
    input.tables![0].cells.splice(4, 1);
    input.tables![0].cells[3].text = '<img src=x onerror=alert(1)>';
    const { container } = render(<DocumentBody content={input} />);
    expect(
      screen.getByRole('cell', { name: '丁' }).getAttribute('rowspan'),
    ).toBe('2');
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeDefined();
    expect(container.querySelector('img')).toBeNull();
  });
  it('loads authenticated inline images using object-scoped tickets', async () => {
    vi.mocked(documentsApi.resourceAccess).mockResolvedValue({
      url: '/image?ticket=scoped',
      expiresInSeconds: 300,
    });
    const input = content();
    input.markdown +=
      '\n\n![原表](/api/v1/storage/object?key=assets%2Fdoc%2Fimage)';
    input.assets = [
      {
        objectKey: 'assets/doc/image',
        url: '/api/v1/storage/object?key=assets%2Fdoc%2Fimage',
        type: 'image',
      },
    ];
    render(<DocumentBody content={input} />);
    const image = await screen.findByRole('img', { name: '原表' });
    expect(image.getAttribute('src')).toBe('/image?ticket=scoped');
    expect(documentsApi.resourceAccess).toHaveBeenCalledWith(
      'assets/doc/image',
    );
  });
  it('shows OCR scope and requires original-source checks even after adoption', () => {
    const input = content();
    input.provenance = { engine: 'mineru', mode: 'ocr' };
    render(<DocumentBody content={input} />);
    expect(
      screen.getByText(/图中箭头、图表数值归属和合并关系可能不完整/),
    ).toBeDefined();
  });
  it('does not hide following content when HTML table metadata overlaps', () => {
    const input = content();
    input.tables!.push({ ...input.tables![0], id: 'overlap' });
    render(<DocumentBody content={input} />);
    expect(screen.getByText('后文')).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('keeps ordinary Markdown tables and ignores stale or overlapping table ranges', () => {
    const input = content();
    input.markdown = '| 项目 | 金额 |\n| --- | --- |\n| 甲 | 0 |';
    input.tables![0].start = -1;
    render(<DocumentBody content={input} />);
    expect(screen.getByRole('cell', { name: '0' })).toBeDefined();
    expect(screen.queryByText('-8.75')).toBeNull();
  });
});
