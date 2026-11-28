import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageHeader } from './page-header';
import { EmptyState } from './empty-state';
import { FileSymbol } from './file-symbol';
import { Icon } from './ui/icon';

// Server rendering keeps these presentation contracts independent of API and browser state.
describe('workspace presentation', () => {
  it('renders one primary heading and an accessible page action', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        eyebrow="Documents"
        title="文档库"
        description="团队文档"
        actions={<button>上传文档</button>}
      />,
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('文档库</h1>');
    expect(html).toContain('<button>上传文档</button>');
  });

  it('escapes user-visible content without creating markup', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        eyebrow="Documents"
        title={'<script>bad</script>'}
        description={'<img src=x>'}
      />,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('offers a concrete next action in an empty state', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="暂无文档"
        description="上传第一份文档"
        action={<button>上传文档</button>}
      />,
    );
    expect(html).toContain('上传第一份文档');
    expect(html).toContain('<button>上传文档</button>');
    expect(html).toContain('aria-hidden="true"');
  });

  it('supports empty states without an action', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        icon="search"
        title="没有匹配结果"
        description="换个关键词"
      />,
    );
    expect(html).toContain('没有匹配结果');
    expect(html).not.toContain('<button');
  });

  it.each(['report.pdf', 'REPORT.PDF'])(
    'recognizes the file format case-insensitively: %s',
    (fileName) => {
      const html = renderToStaticMarkup(<FileSymbol fileName={fileName} />);
      expect(html).toContain('text-rose-600');
      expect(html).toContain('PDF</span>');
      expect(html).toContain('aria-hidden="true"');
    },
  );

  it.each(['README', '', 'archive.unknown'])(
    'renders a neutral fallback for %s',
    (fileName) => {
      const html = renderToStaticMarkup(<FileSymbol fileName={fileName} />);
      expect(html).toContain('text-slate-500');
      expect(html).not.toContain('undefined');
    },
  );

  it('keeps icons decorative while forwarding sizing attributes', () => {
    const html = renderToStaticMarkup(
      <Icon name="search" width={16} height={16} />,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="16"');
  });
});
