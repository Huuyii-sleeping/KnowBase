import { useMemo } from 'react';
import type { GraphSearchPath } from '@/lib/api';
import { cn } from '@/lib/utils';

const VIEWPORT = { width: 960, height: 640 };
const CENTER = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const RING_BASE_ANGLES = [-Math.PI / 2, -Math.PI / 6, Math.PI / 3, (Math.PI * 5) / 6];

export interface GraphNodeView {
  key: string;
  name: string;
  label: string;
  type: string;
  level: number;
  x: number;
  y: number;
  radius: number;
  isSeed: boolean;
  isActive: boolean;
}

export interface GraphEdgeView {
  key: string;
  type: string;
  documentId: string;
  chunkId: string;
  sourceKey: string;
  targetKey: string;
  active: boolean;
  pathId: string;
  d: string;
  labelX: number;
  labelY: number;
  labelAngle: number;
}

export interface KnowledgeGraphView {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  seedLabel: string;
}

function normalizeLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

function splitLabel(value: string): string[] {
  const formatted = normalizeLabel(value);
  if (formatted.length <= 8) return [formatted];
  const parts = formatted.split(' ').filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 2);
  const midpoint = Math.ceil(formatted.length / 2);
  return [formatted.slice(0, midpoint), formatted.slice(midpoint)];
}

function nodeRadius(name: string, isSeed: boolean): number {
  if (isSeed) return 60;
  if (name.length <= 4) return 50;
  if (name.length <= 8) return 54;
  return 58;
}

function pickNodeColors(type: string, isSeed: boolean): { fill: string; stroke: string; text: string } {
  if (isSeed) return { fill: '#F6C453', stroke: '#C7920A', text: '#3b2a05' };
  if (type.includes('消息') || type.includes('队列') || type.includes('RabbitMQ')) {
    return { fill: '#E89AB8', stroke: '#CF6B93', text: '#5f1f3e' };
  }
  if (type.includes('模型') || type.includes('Ollama') || type.includes('qwen')) {
    return { fill: '#9C92E8', stroke: '#7568D6', text: '#2f235f' };
  }
  if (type.includes('图数据库') || type.includes('Neo4j')) {
    return { fill: '#69A7F0', stroke: '#3F7FDF', text: '#10325f' };
  }
  if (type.includes('文档') || type.includes('Chunk') || type.includes('实体') || type.includes('分块')) {
    return { fill: '#8FD7D9', stroke: '#52BFC4', text: '#0f4548' };
  }
  if (type.includes('搜索') || type.includes('Elasticsearch')) {
    return { fill: '#96C96D', stroke: '#67A343', text: '#1f3a11' };
  }
  return { fill: '#D9A9CF', stroke: '#B87CAE', text: '#4a2443' };
}

function ringBaseAngle(level: number): number {
  return RING_BASE_ANGLES[(level - 1) % RING_BASE_ANGLES.length] ?? -Math.PI / 2;
}

export function buildGraph(paths: GraphSearchPath[], activePath: GraphSearchPath | null): KnowledgeGraphView {
  const seedLabel = activePath?.seed.name ?? paths[0]?.seed.name ?? '';
  const seedKey = activePath?.seed.key ?? paths[0]?.seed.key ?? '';
  const nodeMap = new Map<string, GraphNodeView>();
  const edgeMap = new Map<string, GraphEdgeView>();

  for (const path of paths) {
    path.entities.forEach((entity, index) => {
      const existing = nodeMap.get(entity.key);
      const level = existing ? Math.min(existing.level, index) : index;
      nodeMap.set(entity.key, {
        key: entity.key,
        name: entity.name,
        label: normalizeLabel(entity.name),
        type: entity.type,
        level,
        x: existing?.x ?? 0,
        y: existing?.y ?? 0,
        radius: nodeRadius(entity.name, entity.key === seedKey),
        isSeed: entity.key === seedKey,
        isActive: Boolean(activePath?.entities.some((item) => item.key === entity.key)),
      });
    });

    path.relations.forEach((relation, index) => {
      const source = path.entities[index];
      const target = path.entities[index + 1];
      if (!source || !target) return;
      edgeMap.set(relation.key, {
        key: relation.key,
        type: relation.type,
        documentId: relation.documentId,
        chunkId: relation.chunkId,
        sourceKey: source.key,
        targetKey: target.key,
        active: Boolean(activePath?.relations.some((item) => item.key === relation.key)),
        pathId: `${source.key}:${target.key}`,
        d: '',
        labelX: 0,
        labelY: 0,
        labelAngle: 0,
      });
    });
  }

  const groups = new Map<number, GraphNodeView[]>();
  for (const node of nodeMap.values()) {
    const level = node.isSeed ? 0 : node.level;
    const list = groups.get(level) ?? [];
    list.push(node);
    groups.set(level, list);
  }

  const sortedLevels = [...groups.keys()].sort((a, b) => a - b);
  for (const level of sortedLevels) {
    const nodes = groups.get(level) ?? [];
    if (level === 0) {
      nodes.forEach((node) => {
        node.x = CENTER.x;
        node.y = CENTER.y;
      });
      continue;
    }

    const radius = 160 + (level - 1) * 92;
    const startAngle = ringBaseAngle(level);
    const step = nodes.length > 1 ? (Math.PI * 2) / nodes.length : 0;

    nodes.forEach((node, index) => {
      const angle = nodes.length === 1 ? startAngle : startAngle + step * index;
      node.x = CENTER.x + Math.cos(angle) * radius;
      node.y = CENTER.y + Math.sin(angle) * radius;
    });
  }

  for (const edge of edgeMap.values()) {
    const source = nodeMap.get(edge.sourceKey);
    const target = nodeMap.get(edge.targetKey);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const startX = source.x + (dx / length) * source.radius;
    const startY = source.y + (dy / length) * source.radius;
    const endX = target.x - (dx / length) * target.radius;
    const endY = target.y - (dy / length) * target.radius;
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const normalX = -dy / length;
    const normalY = dx / length;
    const bend = Math.min(82, length * 0.2) * (edge.active ? 1 : 0.75);
    const direction = edge.sourceKey < edge.targetKey ? 1 : -1;
    const controlX = midX + normalX * bend * direction;
    const controlY = midY + normalY * bend * direction;
    edge.d = `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;
    edge.labelX = (startX + endX) / 2 + normalX * 14 * direction;
    edge.labelY = (startY + endY) / 2 + normalY * 14 * direction;
    edge.labelAngle = Math.atan2(dy, dx) * (180 / Math.PI);
  }

  return {
    nodes: [...nodeMap.values()].sort((a, b) => a.level - b.level || Number(b.isSeed) - Number(a.isSeed) || a.name.localeCompare(b.name)),
    edges: [...edgeMap.values()],
    seedLabel,
  };
}

function GraphNode({ node }: { node: GraphNodeView }) {
  const colors = pickNodeColors(node.type, node.isSeed);
  const size = node.radius * 2;
  const lines = splitLabel(node.label);

  return (
    <div
      title={`${node.name} · ${node.type}`}
      className={cn(
        'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-4 shadow-sm transition-transform duration-200',
        node.isActive ? 'scale-105' : '',
      )}
      style={{
        left: `${(node.x / VIEWPORT.width) * 100}%`,
        top: `${(node.y / VIEWPORT.height) * 100}%`,
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: colors.fill,
        borderColor: colors.stroke,
        color: colors.text,
      }}
      >
      <span className="flex h-full w-full flex-col items-center justify-center px-3 text-center">
        {lines.map((line, index) => (
          <span key={`${node.key}-${index}`} className={index === 0 ? 'text-[12.5px] font-semibold leading-tight' : 'text-[10px] font-medium leading-tight'}>
            {line}
          </span>
        ))}
      </span>
    </div>
  );
}

export function KnowledgeGraphDiagram({ paths, activePath }: { paths: GraphSearchPath[]; activePath: GraphSearchPath | null }) {
  const graph = useMemo(() => buildGraph(paths, activePath), [paths, activePath]);

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
          <div className="text-[13px] text-foreground">{graph.seedLabel || '当前查询'} · {graph.nodes.length} 个实体 · {graph.edges.length} 条关系</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full border border-border bg-secondary px-2 py-1">中心实体</span>
          <span className="rounded-full border border-border bg-secondary px-2 py-1">关系箭头</span>
          <span className="rounded-full border border-border bg-secondary px-2 py-1">点击左侧路径切换</span>
        </div>
      </div>

      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl border border-border bg-[#fbfbfd]">
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${VIEWPORT.width} ${VIEWPORT.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <marker id="kg-arrow" viewBox="0 0 10 10" refX="7.2" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b8b95" />
            </marker>
          </defs>

          {graph.edges.map((edge) => (
            <g key={edge.key}>
              <path
                d={edge.d}
                fill="none"
                stroke={edge.active ? '#6d72f7' : '#b9bac8'}
                strokeWidth={edge.active ? 2.8 : 2}
                strokeLinecap="round"
                markerEnd="url(#kg-arrow)"
              />
            </g>
          ))}
        </svg>

        {graph.edges.map((edge) => (
          <div
            key={`${edge.key}-label`}
            className={cn(
              'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm',
              edge.active ? 'border-primary/25 bg-primary/10 text-primary' : 'border-border bg-white/90 text-muted-foreground',
            )}
            style={{
              left: `${(edge.labelX / VIEWPORT.width) * 100}%`,
              top: `${(edge.labelY / VIEWPORT.height) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${edge.labelAngle > 90 || edge.labelAngle < -90 ? edge.labelAngle + 180 : edge.labelAngle}deg)`,
            }}
          >
            {edge.type}
          </div>
        ))}

        {graph.nodes.map((node) => (
          <GraphNode key={node.key} node={node} />
        ))}
      </div>
    </div>
  );
}
