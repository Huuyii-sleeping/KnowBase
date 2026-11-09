import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { GraphPathPanel } from './graph-path-panel';
import type { GraphSearchPath } from '@/lib/api';

const path: GraphSearchPath = {
  seed: { key: 'mq', name: 'RabbitMQ', type: '队列' },
  entities: [
    { key: 'mq', name: 'RabbitMQ', type: '队列' },
    { key: 'db', name: 'Neo4j', type: '数据库' },
  ],
  relations: [
    { key: 'r1', type: '写入', documentId: 'doc-1', chunkId: 'doc-1:c1' },
  ],
};

describe('graph path panel', () => {
  it('renders the selected directed path and authorized source links', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GraphPathPanel paths={[path]} activeIndex={0} onSelect={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('写入');
    expect(html).toContain('href="/documents/doc-1"');
    expect(html).toContain('查看来源文档 1');
    expect(html).not.toContain('doc-1:c1');
  });
  it('supports empty results and missing selection without broken source links', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GraphPathPanel paths={[]} activeIndex={0} onSelect={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain('发现的路径');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('沿路径探索');
  });
});
