import { Graph, type GraphOptions } from '@antv/g6';
import { buildKnowledgeGraphData } from '@/lib/knowledge-graph-data';
import { createKnowledgeGraphRenderer } from '@/lib/knowledge-graph-renderer';
import { graphScenarios } from './graph-fixtures';
import { registerReadableGraphLabels } from '@/lib/knowledge-graph-labels';

export interface GraphCheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

// Runs the production renderer with the real G6 engine. The subclass only exposes
// its public API to assertions; no layout, drawing or viewport operations are faked.
export async function runGraphEngineChecks(
  container: HTMLElement,
  report: (result: GraphCheckResult) => void,
) {
  registerReadableGraphLabels();
  let graph!: Graph;
  const errors: string[] = [];
  const onError = (event: ErrorEvent) => errors.push(event.message);
  const onRejection = (event: PromiseRejectionEvent) =>
    errors.push(String(event.reason));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  class ObservedGraph extends Graph {
    constructor(options: GraphOptions) {
      super(options);
      graph = this;
    }
  }
  const renderer = createKnowledgeGraphRenderer(
    container,
    {
      onReady: () => {},
      onError: (error) => errors.push(error),
      onSelect: () => {},
    },
    async () => ({ Graph: ObservedGraph }),
  );
  const check = (name: string, passed: boolean, detail = '') =>
    report({ name, passed, detail });
  try {
    for (const [scenario, fixture] of Object.entries(graphScenarios)) {
      const dataset = buildKnowledgeGraphData(
        fixture.paths,
        fixture.paths[0] ?? null,
        'Knowbase',
      );
      for (const mode of ['network', 'flow'] as const) {
        const started = performance.now();
        await renderer.update(dataset, mode);
        check(
          `${scenario}/${mode} 渲染`,
          errors.length === 0,
          `${dataset.nodeCount} 节点 / ${dataset.edgeCount} 关系 / ${Math.round(performance.now() - started)} ms ${errors.join('; ')}`,
        );
        check(
          `${scenario}/${mode} 数据完整`,
          graph.getNodeData().length === dataset.nodeCount &&
            graph.getEdgeData().length === dataset.edgeCount,
        );
        const nodes = graph.getNodeData();
        const outside: string[] = [];
        let finite = true;
        for (const node of nodes) {
          const position = graph.getElementPosition(node.id);
          const point = graph.getViewportByCanvas(position);
          const radius = (node.data?.isSeed ? 40 : 32) * graph.getZoom();
          finite &&= [...position, ...point].every(Number.isFinite);
          if (
            point[0] - radius < 0 ||
            point[1] - radius < 0 ||
            point[0] + radius > container.clientWidth ||
            point[1] + radius > container.clientHeight
          )
            outside.push(String(node.data?.label));
        }
        check(`${scenario}/${mode} 有限坐标`, finite);
        const edges = graph.getEdgeData();
        check(
          `${scenario}/${mode} 连线几何有效`,
          edges.every((edge) => {
            const bounds = graph.getElementRenderBounds(edge.id!);
            return [...bounds.min, ...bounds.max].every(Number.isFinite);
          }),
        );
        if (mode === 'network' && nodes.length > 1) {
          let overlaps = 0;
          for (let i = 0; i < nodes.length; i++)
            for (let j = i + 1; j < nodes.length; j++) {
              const a = graph.getElementPosition(nodes[i].id);
              const b = graph.getElementPosition(nodes[j].id);
              const separation =
                (nodes[i].data?.isSeed ? 40 : 32) +
                (nodes[j].data?.isSeed ? 40 : 32);
              if (Math.hypot(a[0] - b[0], a[1] - b[1]) < separation) overlaps++;
            }
          check(
            `${scenario}/${mode} 节点圆形不重叠`,
            overlaps === 0,
            `${overlaps} 对重叠`,
          );
        }
        check(
          `${scenario}/${mode} 节点均在画布内`,
          outside.length === 0,
          `${container.clientWidth}×${container.clientHeight} zoom=${graph.getZoom().toFixed(3)} first=${
            nodes[0]
              ? Array.from(
                  graph.getViewportByCanvas(
                    graph.getElementPosition(nodes[0].id),
                  ),
                )
                  .map((n) => n.toFixed(1))
                  .join(',')
              : '-'
          } outside=${outside.length}: ${outside.slice(0, 4).join('、')}`,
        );
        if (nodes.length > 1) {
          await renderer.zoom(1.2);
          const zoom = graph.getZoom();
          const positions = JSON.stringify(
            nodes.map((node) => graph.getElementPosition(node.id)),
          );
          await renderer.update(
            buildKnowledgeGraphData(
              fixture.paths,
              fixture.paths.at(-1) ?? null,
              'Knowbase',
            ),
            mode,
          );
          check(
            `${scenario}/${mode} 切换路径保留视口和坐标`,
            Math.abs(zoom - graph.getZoom()) < 0.0001 &&
              positions ===
                JSON.stringify(
                  nodes.map((node) => graph.getElementPosition(node.id)),
                ),
          );
        }
      }
    }
    const paths = graphScenarios.complex.paths;
    const dataset = buildKnowledgeGraphData(paths, paths[0], 'Knowbase');
    await renderer.update(dataset, 'network');
    await graph.translateElementBy(dataset.seedId, [35, -20], false);
    const dragged = JSON.stringify(graph.getElementPosition(dataset.seedId));
    await renderer.update(
      buildKnowledgeGraphData(paths, paths[2], 'Knowbase'),
      'network',
    );
    check(
      '拖动后切换路径保留节点位置',
      dragged === JSON.stringify(graph.getElementPosition(dataset.seedId)),
    );
    const pending = renderer.update(dataset, 'flow');
    const latest = renderer.update(
      buildKnowledgeGraphData([], null),
      'network',
    );
    await Promise.all([pending, latest]);
    check('快速切换仅保留最后一次数据', graph.getNodeData().length === 0);
  } catch (error) {
    check('引擎异常', false, String(error));
  } finally {
    await renderer.destroy();
    check('销毁后清理画布', container.querySelectorAll('canvas').length === 0);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    check('全程无运行时异常', errors.length === 0, errors.join('; '));
  }
}
