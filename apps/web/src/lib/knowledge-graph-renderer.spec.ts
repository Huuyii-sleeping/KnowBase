import { describe, expect, it, vi } from 'vitest';
import type { Graph, GraphOptions } from '@antv/g6';
import { createKnowledgeGraphRenderer } from './knowledge-graph-renderer';
import { buildKnowledgeGraphData } from './knowledge-graph-data';
import type { GraphSearchPath } from './api';

const path: GraphSearchPath = {
  seed: { key: 'mq', name: 'RabbitMQ', type: '队列' },
  entities: [
    { key: 'mq', name: 'RabbitMQ', type: '队列' },
    { key: 'db', name: 'Neo4j', type: '数据库' },
  ],
  relations: [{ key: 'r1', type: '写入', documentId: 'doc1', chunkId: 'c1' }],
};
const dataset = buildKnowledgeGraphData([path], path);

function fixture() {
  const fake = {
    on: vi.fn(),
    setSize: vi.fn(),
    setData: vi.fn(),
    setOptions: vi.fn(),
    updateData: vi.fn(),
    render: vi.fn().mockResolvedValue(undefined),
    draw: vi.fn().mockResolvedValue(undefined),
    zoomTo: vi.fn().mockResolvedValue(undefined),
    zoomBy: vi.fn().mockResolvedValue(undefined),
    fitView: vi.fn().mockResolvedValue(undefined),
    fitCenter: vi.fn().mockResolvedValue(undefined),
    getZoom: vi.fn().mockReturnValue(0.8),
    destroy: vi.fn(),
  };
  const constructor = vi.fn(function (_options: GraphOptions) {
    return fake;
  });
  const callbacks = { onReady: vi.fn(), onError: vi.fn(), onSelect: vi.fn() };
  const module = {
    Graph: constructor as unknown as new (options: GraphOptions) => Graph,
  };
  const load = vi.fn().mockResolvedValue(module);
  return { fake, constructor, callbacks, module, load };
}

describe('knowledge graph renderer lifecycle', () => {
  it('ignores G6 transform events until its viewport has initialized', async () => {
    const f = fixture();
    f.fake.render.mockImplementationOnce(async () => {
      const transform = f.fake.on.mock.calls.find(
        ([name]) => name === 'aftertransform',
      )?.[1];
      f.fake.getZoom.mockImplementationOnce(() => {
        throw new Error('viewport not initialized');
      });
      transform();
      expect(f.callbacks.onReady).not.toHaveBeenCalled();
      expect(f.fake.getZoom).not.toHaveBeenCalled();
      f.fake.getZoom.mockReset().mockReturnValue(0.8);
    });
    const renderer = createKnowledgeGraphRenderer(
      {} as HTMLElement,
      f.callbacks,
      f.load,
    );
    await renderer.update(dataset, 'network');
    expect(f.callbacks.onError).not.toHaveBeenCalled();
    expect(f.callbacks.onReady).toHaveBeenCalledWith(0.8);
    await renderer.destroy();
  });
  it('loads and fits the network, and exposes zoom controls', async () => {
    const f = fixture();
    const renderer = createKnowledgeGraphRenderer(
      {} as HTMLElement,
      f.callbacks,
      f.load,
    );
    await renderer.update(dataset, 'network');
    expect(f.fake.render).toHaveBeenCalledOnce();
    expect(f.fake.fitView).toHaveBeenCalledWith({ when: 'always' }, false);
    expect(f.callbacks.onReady).toHaveBeenLastCalledWith(0.8);
    await renderer.resize(800, 600);
    expect(f.fake.setSize).toHaveBeenCalledWith(800, 600);
    expect(f.fake.setOptions).toHaveBeenLastCalledWith({
      padding: [70, 90, 90, 90],
    });
    await renderer.resize(390, 470);
    expect(f.fake.setOptions).toHaveBeenLastCalledWith({
      padding: [70, 24, 90, 24],
    });
    await renderer.resize(0, 0);
    expect(f.fake.setSize).toHaveBeenCalledTimes(2);
    await renderer.zoom(1.2);
    expect(f.fake.zoomBy).toHaveBeenCalledWith(1.2, false);
    await renderer.destroy();
    expect(f.fake.destroy).toHaveBeenCalledOnce();
  });

  it('keeps positions and viewport when only the selected path changes', async () => {
    const f = fixture();
    const renderer = createKnowledgeGraphRenderer(
      {} as HTMLElement,
      f.callbacks,
      f.load,
    );
    await renderer.update(dataset, 'network');
    await renderer.update(buildKnowledgeGraphData([path], null), 'network');
    expect(f.fake.render).toHaveBeenCalledOnce();
    expect(f.fake.draw).toHaveBeenCalledOnce();
    expect(f.fake.fitView).toHaveBeenCalledOnce();
    await renderer.update(dataset, 'flow');
    expect(f.fake.render).toHaveBeenCalledTimes(2);
    await renderer.destroy();
  });

  it('does not create a canvas after unmount during library loading', async () => {
    const f = fixture();
    let resolve!: (module: typeof f.module) => void;
    const loading = new Promise<typeof f.module>((done) => {
      resolve = done;
    });
    const renderer = createKnowledgeGraphRenderer(
      {} as HTMLElement,
      f.callbacks,
      () => loading,
    );
    const pending = renderer.update(dataset, 'network');
    await Promise.resolve();
    const destroyed = renderer.destroy();
    resolve(f.module);
    await Promise.all([pending, destroyed]);
    expect(f.constructor).not.toHaveBeenCalled();
    expect(f.callbacks.onReady).not.toHaveBeenCalled();
  });

  it('drops stale updates while the engine is loading', async () => {
    const f = fixture();
    let resolve!: (module: typeof f.module) => void;
    const loading = new Promise<typeof f.module>((done) => {
      resolve = done;
    });
    const renderer = createKnowledgeGraphRenderer(
      {} as HTMLElement,
      f.callbacks,
      () => loading,
    );
    const first = renderer.update(dataset, 'network');
    await Promise.resolve();
    const second = renderer.update(dataset, 'flow');
    resolve(f.module);
    await Promise.all([first, second]);
    expect(f.constructor).toHaveBeenCalledOnce();
    expect(f.fake.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: expect.objectContaining({ type: 'antv-dagre' }),
      }),
    );
    await renderer.destroy();
  });

  it('surfaces load failure and allows a later retry', async () => {
    const f = fixture();
    f.load.mockRejectedValueOnce(new Error('engine unavailable'));
    const renderer = createKnowledgeGraphRenderer(
      {} as HTMLElement,
      f.callbacks,
      f.load,
    );
    await renderer.update(dataset, 'network');
    expect(f.callbacks.onError).toHaveBeenCalledWith(
      '关系图暂时无法显示，请重新加载画布。',
    );
    await renderer.update(dataset, 'network');
    expect(f.fake.render).toHaveBeenCalledOnce();
    await renderer.destroy();
  });

  it('cleans up after rendering fails without reporting after disposal', async () => {
    const f = fixture();
    f.fake.render.mockRejectedValueOnce(new Error('layout failed'));
    const renderer = createKnowledgeGraphRenderer(
      {} as HTMLElement,
      f.callbacks,
      f.load,
    );
    await renderer.update(dataset, 'network');
    expect(f.callbacks.onError).toHaveBeenCalledWith(
      '关系图暂时无法显示，请重新加载画布。',
    );
    await renderer.destroy();
    await renderer.zoom(1.2);
    expect(f.fake.destroy).toHaveBeenCalledOnce();
    expect(f.fake.zoomBy).not.toHaveBeenCalled();
  });
});
