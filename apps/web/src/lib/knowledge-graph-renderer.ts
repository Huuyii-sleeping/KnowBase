import type {
  EdgeData,
  Graph as G6Graph,
  GraphOptions,
  IElementEvent,
  NodeData,
} from '@antv/g6';
import type { KnowledgeGraphDataset } from './knowledge-graph-data';
import {
  getGraphEdgeStyle,
  getGraphNodeStyle,
  getGraphTopologyKey,
  makeGraphLayout,
  type GraphLayoutMode,
} from './knowledge-graph-presentation';

interface RendererCallbacks {
  onReady: (zoom: number) => void;
  onError: (message: string) => void;
  onSelect: (id: string | null) => void;
}

type GraphLoader = () => Promise<{
  Graph: new (options: GraphOptions) => G6Graph;
}>;

const canvasPadding = (width: number): GraphOptions['padding'] =>
  width < 600 ? [70, 24, 90, 24] : [70, 90, 90, 90];

// Serialize canvas operations: a path change or unmount can arrive while G6 is still loading or laying out.
export function createKnowledgeGraphRenderer(
  container: HTMLElement,
  callbacks: RendererCallbacks,
  load: GraphLoader = async () => {
    const g6 = await import('@antv/g6');
    const { registerReadableGraphLabels } =
      await import('./knowledge-graph-labels');
    registerReadableGraphLabels();
    return g6;
  },
) {
  let instance: G6Graph | null = null;
  let disposed = false;
  let revision = 0;
  let topology = '';
  let ready = false;
  let queue = Promise.resolve();

  const enqueue = (action: () => Promise<void>) => {
    queue = queue
      .then(async () => {
        if (!disposed) await action();
      })
      .catch((error: unknown) => {
        if (!disposed)
          callbacks.onError(
            error instanceof Error
              ? error.message
              : '关系图暂时无法显示，请重试。',
          );
      });
    return queue;
  };

  const fit = async () => {
    if (!instance || disposed) return;
    await instance.zoomTo(1, false);
    await instance.fitView({ when: 'always' }, false);
    if (instance.getZoom() > 1) await instance.zoomTo(1, false);
    await instance.fitCenter(false);
  };

  return {
    update(dataset: KnowledgeGraphDataset, mode: GraphLayoutMode) {
      const current = ++revision;
      return enqueue(async () => {
        if (current !== revision) return;
        if (!instance) {
          const { Graph } = await load();
          if (disposed || current !== revision) return;
          instance = new Graph({
            container,
            autoResize: false,
            background: 'transparent',
            animation: false,
            padding: canvasPadding(container.clientWidth),
            zoomRange: [0.02, 2.5],
            node: {
              type: 'circle',
              style: getGraphNodeStyle,
              state: {
                hover: {
                  lineWidth: 3,
                  halo: true,
                  haloLineWidth: 8,
                  haloStrokeOpacity: 0.1,
                },
              },
            },
            edge: {
              type: 'quadratic',
              style: getGraphEdgeStyle,
              state: { hover: { lineWidth: 2.5, stroke: '#18777c' } },
            },
            behaviors: [
              'drag-canvas',
              'zoom-canvas',
              'drag-element',
              { type: 'hover-activate', state: 'hover', degree: 1 },
              'knowbase-readable-labels',
              {
                type: 'auto-adapt-label',
                padding: 6,
                sortNode: (a: NodeData, b: NodeData) => {
                  const priority = (node: NodeData) =>
                    node.data?.isSeed ? 2 : node.data?.isActive ? 1 : 0;
                  return Math.sign(priority(b) - priority(a));
                },
                sortEdge: (a: EdgeData, b: EdgeData) =>
                  a.data?.isActive === b.data?.isActive
                    ? 0
                    : a.data?.isActive
                      ? -1
                      : 1,
              },
            ],
            transforms: [
              { type: 'process-parallel-edges', mode: 'bundle', distance: 28 },
            ],
          });
          instance.on('node:click', (event: IElementEvent) => {
            if (!disposed) callbacks.onSelect(event.target.id);
          });
          instance.on('canvas:click', () => {
            if (!disposed) callbacks.onSelect(null);
          });
          instance.on('aftertransform', () => {
            // G6 emits a transform while constructing its viewport controller.
            // getZoom() is only available after the first render has completed.
            if (!disposed && ready && instance)
              callbacks.onReady(instance.getZoom());
          });
        }
        const nextTopology = getGraphTopologyKey(
          dataset.data.nodes ?? [],
          dataset.data.edges ?? [],
          dataset.seedId,
          mode,
        );
        if (topology !== nextTopology) {
          ready = false;
          instance.setData(dataset.data);
          instance.setOptions({
            layout: makeGraphLayout(mode, dataset.seedId),
          });
          await instance.render();
          if (disposed) return;
          ready = true;
          await fit();
          topology = nextTopology;
        } else {
          instance.updateData(dataset.data);
          await instance.draw();
        }
        if (!disposed && current === revision)
          callbacks.onReady(instance.getZoom());
      });
    },
    zoom(ratio: number) {
      return enqueue(async () => {
        if (instance) {
          await instance.zoomBy(ratio, false);
          if (!disposed) callbacks.onReady(instance.getZoom());
        }
      });
    },
    fit() {
      return enqueue(fit);
    },
    resize(width: number, height: number) {
      if (width <= 0 || height <= 0) return Promise.resolve();
      return enqueue(async () => {
        if (!instance) return;
        instance.setSize(width, height);
        instance.setOptions({ padding: canvasPadding(width) });
        await instance.draw();
        await fit();
      });
    },
    destroy() {
      disposed = true;
      revision += 1;
      return queue.then(() => {
        instance?.destroy();
        instance = null;
      });
    },
  };
}
