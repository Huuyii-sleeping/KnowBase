import { useEffect, useMemo, useRef, useState } from 'react';
import type { EdgeData, Graph as G6Graph, NodeData } from '@antv/g6';
import type { GraphSearchPath } from '@/lib/api';
import { buildKnowledgeGraphData, type KnowledgeGraphEdgeData, type KnowledgeGraphNodeData } from '@/lib/knowledge-graph-data';
import { cn } from '@/lib/utils';

const NODE_PALETTES = {
  seed: { fill: '#F4C65A', stroke: '#A77407', label: '#392703', badgeFill: '#FFF1C9', badgeText: '#7B5100' },
  document: { fill: '#8DD8DA', stroke: '#2D9DA2', label: '#0C4D52', badgeFill: '#E3F7F8', badgeText: '#0E6570' },
  model: { fill: '#B4A4FF', stroke: '#6550D7', label: '#2C1A74', badgeFill: '#E7E0FF', badgeText: '#5940B5' },
  queue: { fill: '#F2A1C1', stroke: '#CF688F', label: '#6F1B45', badgeFill: '#FDE4EE', badgeText: '#A03E69' },
  database: { fill: '#84B9FF', stroke: '#2F6FD6', label: '#14386E', badgeFill: '#E0ECFF', badgeText: '#345A9C' },
  search: { fill: '#9FD77A', stroke: '#5E9D44', label: '#28421A', badgeFill: '#E5F5D8', badgeText: '#497734' },
  platform: { fill: '#D3D6E7', stroke: '#7B84A3', label: '#2E3349', badgeFill: '#EFF1F7', badgeText: '#5A6383' },
  concept: { fill: '#D9CDA8', stroke: '#A68E59', label: '#4F4020', badgeFill: '#F2E9CF', badgeText: '#7F6940' },
  other: { fill: '#D8D4F2', stroke: '#8A7ED0', label: '#403A72', badgeFill: '#ECE9FF', badgeText: '#6757B5' },
} as const;

type PaletteName = keyof typeof NODE_PALETTES;

function getNodePalette(node: KnowledgeGraphNodeData) {
  return NODE_PALETTES[node.group as PaletteName] ?? NODE_PALETTES.other;
}

function makeLayout(maxHops: number) {
  return {
    type: 'concentric',
    sortBy: (node: NodeData) => {
      const data = node.data as KnowledgeGraphNodeData | undefined;
      if (data?.isSeed) return 10_000;
      return 10_000 - Number(data?.depth ?? 0) * 1000 - Number(data?.order ?? 0);
    },
    startAngle: -Math.PI / 2,
    sweep: Math.PI * 2 * 0.92,
    clockwise: true,
    equidistant: true,
    preventOverlap: true,
    nodeSize: (node: NodeData) => Number(node.data?.size ?? 72),
    maxLevelDiff: 500,
    width: 960,
    height: Math.max(560, 440 + maxHops * 36),
  } as const;
}

function getNodeStyle(datum: NodeData) {
  const data = datum.data as KnowledgeGraphNodeData | undefined;
  const palette = data ? getNodePalette(data) : NODE_PALETTES.other;
  const isSeed = Boolean(data?.isSeed);
  const isActive = Boolean(data?.isActive);
  const size = Number(data?.size ?? 76);

  return {
    size,
    fill: palette.fill,
    stroke: isSeed ? palette.stroke : palette.stroke,
    lineWidth: isSeed ? 2.5 : 1.8,
    labelText: data?.label ?? datum.id,
    labelFill: palette.label,
    labelFontSize: isSeed ? 14 : 12,
    labelFontWeight: isSeed ? 700 : 600,
    labelWordWrap: false,
    labelOffsetX: 0,
    labelOffsetY: 12,
    badge: true,
    badges: data?.entityType
      ? [
          {
            text: data.entityType,
            placement: 'top-right' as const,
            backgroundFill: palette.badgeFill,
            fill: palette.badgeText,
            fontSize: 10,
            padding: [2, 7, 2, 7],
            backgroundRadius: 999,
            backgroundOpacity: 1,
          },
        ]
      : [],
    shadowBlur: isActive ? 10 : 0,
    shadowColor: isActive ? palette.stroke : undefined,
  };
}

function getEdgeStyle(datum: EdgeData) {
  const data = datum.data as KnowledgeGraphEdgeData | undefined;
  const isActive = Boolean(data?.isActive);

  return {
    stroke: isActive ? '#4f46e5' : '#B9BECA',
    lineWidth: isActive ? 2.8 : 1.8,
    opacity: isActive ? 1 : 0.82,
    endArrow: true,
    endArrowType: 'vee' as const,
    endArrowSize: 8,
    label: true,
    labelText: data?.relationType ?? '',
    labelFill: isActive ? '#312E81' : '#5F6778',
    labelFontSize: 11,
    labelFontWeight: 600,
    labelWordWrap: false,
    labelPadding: [2, 8, 2, 8],
    labelBackground: true,
    labelBackgroundFill: isActive ? '#EEF2FF' : '#FFFFFF',
    labelBackgroundOpacity: 0.95,
    labelBackgroundRadius: 999,
    labelBackgroundLineWidth: 0,
  };
}

function useKnowledgeGraph(paths: GraphSearchPath[], activePath: GraphSearchPath | null) {
  return useMemo(() => buildKnowledgeGraphData(paths, activePath), [paths, activePath]);
}

export function KnowledgeGraphDiagram({ paths, activePath }: { paths: GraphSearchPath[]; activePath: GraphSearchPath | null }) {
  const graphRef = useRef<G6Graph | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const graph = useKnowledgeGraph(paths, activePath);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || graphRef.current) return;

    let cancelled = false;
    let instance: G6Graph | null = null;
    let renderPromise: Promise<void> | null = null;

    void import('@antv/g6').then(({ Graph }) => {
      if (cancelled) return;

      instance = new Graph({
        container,
        autoResize: true,
        autoFit: 'view',
        padding: [32, 28, 32, 28],
        background: '#FBFCFF',
        data: { nodes: [], edges: [] },
        layout: makeLayout(activePath?.entities.length ?? 2),
        node: {
          type: 'circle',
          style: getNodeStyle,
          state: {
            active: {
              lineWidth: 3,
              shadowBlur: 12,
            },
            hover: {
              lineWidth: 3,
              shadowBlur: 8,
            },
            inactive: {
              opacity: 0.18,
            },
          },
        },
        edge: {
          type: 'cubic',
          style: getEdgeStyle,
          state: {
            active: {
              lineWidth: 3,
              opacity: 1,
            },
            hover: {
              lineWidth: 3,
              opacity: 1,
            },
            inactive: {
              opacity: 0.1,
            },
          },
        },
        behaviors: [
          'drag-canvas',
          'zoom-canvas',
          {
            type: 'hover-activate',
            state: 'hover',
            inactiveState: 'inactive',
            degree: 1,
            direction: 'both',
          },
          {
            type: 'focus-element',
            animation: {
              duration: 240,
              easing: 'ease-out',
            },
            enable: true,
          },
        ],
        transforms: [],
      });

      graphRef.current = instance;
      instance.setData(graph.data);
      renderPromise = instance.render().catch((error: unknown) => {
        if (!cancelled && graphRef.current === instance) {
          setRenderError(error instanceof Error ? error.message : '图谱渲染失败');
        }
      });
    }).catch((error: unknown) => {
      if (!cancelled) setRenderError(error instanceof Error ? error.message : '图谱引擎加载失败');
    });


    return () => {
      cancelled = true;
      if (renderPromise) void renderPromise.finally(() => instance?.destroy());
      else instance?.destroy();
      if (graphRef.current === instance) graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = graphRef.current;
    if (!instance) return;

    let cancelled = false;
    setRenderError(null);
    try {
      instance.setData(graph.data);
      instance.setOptions({
        layout: makeLayout(activePath?.entities.length ?? 2),
        transforms: [],
      });
      void instance.render().catch((error: unknown) => {
        if (cancelled || graphRef.current !== instance) return;
        setRenderError(error instanceof Error ? error.message : '图谱渲染失败');
      });
    } catch (error) {
      if (!cancelled && graphRef.current === instance) {
        setRenderError(error instanceof Error ? error.message : '图谱渲染失败');
      }
    }

    return () => {
      cancelled = true;
    };
  }, [activePath?.entities.length, graph]);

  if (!paths.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background px-6 py-14 text-center text-[13px] text-muted-foreground">
        没有可视化的数据
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div>
          <div className="text-[12px] font-medium text-muted-foreground">实体关系图</div>
          <div className="text-[13px] text-foreground">
            {graph.seedLabel || '当前查询'} · {graph.nodeCount} 个实体 · {graph.edgeCount} 条关系
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full border border-border bg-secondary px-2 py-1">中心实体</span>
          <span className="rounded-full border border-border bg-secondary px-2 py-1">关系箭头</span>
          <span className="rounded-full border border-border bg-secondary px-2 py-1">悬停高亮</span>
        </div>
      </div>

      {renderError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          图谱渲染失败：{renderError}
        </div>
      ) : (
        <div
          ref={containerRef}
          className={cn('relative w-full overflow-hidden rounded-xl border border-border bg-[#fbfcff]', 'h-[560px]')}
        />
      )}
    </div>
  );
}
