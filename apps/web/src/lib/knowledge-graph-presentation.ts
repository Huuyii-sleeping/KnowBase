import type { EdgeData, GraphOptions, NodeData } from '@antv/g6';
import type {
  KnowledgeGraphEdgeData,
  KnowledgeGraphNodeData,
} from './knowledge-graph-data';

export type GraphLayoutMode = 'network' | 'flow';

export const GRAPH_PALETTES = {
  seed: {
    label: '查询实体',
    fill: '#18777c',
    stroke: '#18777c',
    ink: '#ffffff',
  },
  document: {
    label: '文档与分块',
    fill: '#e8f3f3',
    stroke: '#8ebcbd',
    ink: '#317c80',
  },
  model: { label: '模型', fill: '#eeecfa', stroke: '#b3a9db', ink: '#7860ad' },
  queue: {
    label: '消息队列',
    fill: '#fff1e5',
    stroke: '#dfb088',
    ink: '#ae7340',
  },
  database: {
    label: '数据库',
    fill: '#eaf0fc',
    stroke: '#9db6df',
    ink: '#507cbb',
  },
  search: { label: '检索', fill: '#edf5e9', stroke: '#a5c693', ink: '#62834d' },
  platform: {
    label: '系统与服务',
    fill: '#eaf0f5',
    stroke: '#a4b7c9',
    ink: '#617e98',
  },
  concept: {
    label: '概念与能力',
    fill: '#f4eff7',
    stroke: '#c6add4',
    ink: '#9473a6',
  },
  other: {
    label: '其他实体',
    fill: '#f0f3f6',
    stroke: '#b9c4cf',
    ink: '#738394',
  },
} as const;

export function getGraphPalette(group?: string) {
  return (
    GRAPH_PALETTES[group as keyof typeof GRAPH_PALETTES] ?? GRAPH_PALETTES.other
  );
}

function nodeMonogram(label: string) {
  const known: Record<string, string> = {
    rabbitmq: 'MQ',
    neo4j: 'N4',
    ollama: 'AI',
    elasticsearch: 'ES',
    knowbase: 'KB',
  };
  return (
    known[label.toLowerCase()] ??
    (label.match(/[A-Z]/g)?.slice(0, 2).join('') ||
      [...label].slice(0, 2).join(''))
  );
}

export function getGraphNodeStyle(datum: NodeData) {
  const data = datum.data as KnowledgeGraphNodeData | undefined;
  const palette = getGraphPalette(data?.group);
  const seed = Boolean(data?.isSeed);
  return {
    size: seed ? 80 : 64,
    fill: palette.fill,
    stroke: data?.isActive && !seed ? palette.ink : palette.stroke,
    lineWidth: data?.isActive ? 2 : 1.5,
    shadowColor: '#223b4c0c',
    shadowBlur: 10,
    shadowOffsetY: 4,
    icon: true,
    iconText: nodeMonogram(data?.label ?? String(datum.id)),
    iconFill: palette.ink,
    iconFontSize: seed ? 23 : 19,
    iconFontWeight: 600,
    iconFontFamily: 'Avenir Next, PingFang SC, sans-serif',
    labelText: data?.label ?? datum.id,
    labelPlacement: 'bottom' as const,
    labelOffsetY: 12,
    labelFill: '#273c4b',
    labelFontSize: 13,
    labelFontWeight: seed ? 650 : 500,
    labelFontFamily: 'Avenir Next, PingFang SC, sans-serif',
    labelWordWrap: true,
    labelMaxWidth: 164,
    labelMaxLines: 2,
    labelBackground: true,
    labelBackgroundFill: '#fbfdfe',
    labelBackgroundOpacity: 0.92,
    labelPadding: [2, 5],
    labelBackgroundRadius: 4,
    halo: seed,
    haloStroke: '#18777c',
    haloLineWidth: 10,
    haloStrokeOpacity: 0.08,
    cursor: 'pointer' as const,
  };
}

export function getGraphEdgeStyle(datum: EdgeData) {
  const data = datum.data as KnowledgeGraphEdgeData | undefined;
  const active = Boolean(data?.isActive);
  return {
    stroke: active ? '#4c969b' : '#c3ced9',
    lineWidth: active ? 1.8 : 1.2,
    curveOffset: 22,
    endArrow: true,
    endArrowSize: 6,
    endArrowType: 'triangle' as const,
    labelText: data?.relationType ?? '',
    labelFill: active ? '#3a7e83' : '#768695',
    labelFontSize: 11,
    labelFontFamily: 'Avenir Next, PingFang SC, sans-serif',
    labelAutoRotate: false,
    labelBackground: true,
    labelBackgroundFill: '#ffffff',
    labelBackgroundRadius: 5,
    labelBackgroundLineWidth: 1,
    labelBackgroundStroke: active ? '#dceced' : '#e9eef2',
    labelPadding: [4, 8],
    labelOffsetY: -2,
  };
}

export function makeGraphLayout(
  mode: GraphLayoutMode,
  seedId: string,
): GraphOptions['layout'] {
  return mode === 'network'
    ? {
        type: 'd3-force',
        animation: false,
        iterations: 280,
        center: false,
        link: { distance: 185, strength: 0.08 },
        manyBody: { strength: -650 },
        collide: { radius: 86, strength: 0.9 },
        radial: {
          x: 0,
          y: 0,
          radius: (node) => (node.id === seedId ? 0 : 190),
          strength: (node) => (node.id === seedId ? 2 : 0.65),
        },
      }
    : {
        type: 'antv-dagre',
        rankdir: 'LR',
        nodesep: 80,
        ranksep: 160,
        nodeSize: [150, 120],
        animation: false,
      };
}

export function getGraphTopologyKey(
  nodes: NodeData[],
  edges: EdgeData[],
  seedId: string,
  mode: GraphLayoutMode,
) {
  return JSON.stringify([
    mode,
    seedId,
    nodes.map((node) => node.id).sort(),
    edges.map((edge) => [edge.id, edge.source, edge.target]).sort(),
  ]);
}
