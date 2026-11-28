import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GraphSearchPath } from '@/lib/api';
import {
  buildKnowledgeGraphData,
  type KnowledgeGraphNodeData,
} from '@/lib/knowledge-graph-data';
import {
  getGraphPalette,
  type GraphLayoutMode,
} from '@/lib/knowledge-graph-presentation';
import { useKnowledgeGraph } from '@/hooks/use-knowledge-graph';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

export function KnowledgeGraphDiagram({
  paths,
  activePath,
  query = '',
}: {
  paths: GraphSearchPath[];
  activePath: GraphSearchPath | null;
  query?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<GraphLayoutMode>('network');
  const [expanded, setExpanded] = useState(false);
  const dataset = useMemo(
    () => buildKnowledgeGraphData(paths, activePath, query),
    [paths, activePath, query],
  );
  const canvas = useKnowledgeGraph(container, dataset, mode);
  const selected = dataset.data.nodes?.find(
    (node) => node.id === canvas.selectedId,
  )?.data as KnowledgeGraphNodeData | undefined;
  const groups = [
    ...new Set(
      dataset.data.nodes?.map((node) => String(node.data?.group)) ?? [],
    ),
  ];

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        section.current?.querySelectorAll<HTMLElement>('button, select, a') ??
          [],
      ).filter((element) => !element.hasAttribute('disabled'));
    expandButton.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (event.shiftKey && document.activeElement === elements[0]) {
        event.preventDefault();
        elements.at(-1)?.focus();
      }
      if (!event.shiftKey && document.activeElement === elements.at(-1)) {
        event.preventDefault();
        elements[0]?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', close);
      expandButton.current?.focus();
    };
  }, [expanded]);

  return (
    <section
      ref={section}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded || undefined}
      aria-label="实体关系图"
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-white shadow-sm',
        expanded && 'fixed inset-3 z-50 shadow-2xl sm:inset-6',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-semibold">
            <Icon
              name="graph"
              width={17}
              height={17}
              className="text-primary"
            />
            实体关系图
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {dataset.seedLabel} 的知识网络
            <span className="mx-2 text-border">/</span>
            {dataset.nodeCount} 个实体 · {dataset.edgeCount} 条关系
          </p>
        </div>
        <div className="flex rounded-lg bg-muted p-1" aria-label="图谱布局">
          {(
            [
              ['network', '关系网络'],
              ['flow', '层级视图'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors',
                mode === value
                  ? 'bg-white text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div
        className={cn(
          'graph-network-canvas relative isolate h-[470px] min-h-0 sm:h-[610px]',
          expanded && 'h-auto flex-1 sm:h-auto',
        )}
      >
        <div
          ref={container}
          role="img"
          aria-label={`${dataset.seedLabel} 的关系网络，${dataset.nodeCount} 个实体，${dataset.edgeCount} 条关系。可通过下方选择框查看实体详情。`}
          className="absolute inset-0"
        />
        <div className="pointer-events-none absolute left-5 top-5 z-10 flex max-w-[75%] flex-wrap gap-x-4 gap-y-2">
          {groups.map((group) => {
            const palette = getGraphPalette(group);
            return (
              <span
                key={group}
                className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor:
                      group === 'seed' ? palette.fill : palette.stroke,
                  }}
                />
                {palette.label}
              </span>
            );
          })}
        </div>
        <Button
          ref={expandButton}
          variant="outline"
          size="sm"
          className="absolute right-4 top-4 z-10 bg-white px-2 shadow-sm"
          aria-label={expanded ? '收起画布' : '展开画布'}
          title={expanded ? '收起画布' : '展开画布'}
          onClick={() => setExpanded(!expanded)}
        >
          <Icon name={expanded ? 'close' : 'expand'} width={16} height={16} />
        </Button>
        {canvas.loading && !canvas.error && (
          <div
            role="status"
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/70 text-xs text-muted-foreground"
          >
            正在整理关系网络…
          </div>
        )}
        {canvas.error && (
          <div
            role="alert"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white/95 px-6 text-center"
          >
            <p className="text-sm font-medium">关系图暂时无法显示</p>
            <p className="max-w-md text-xs text-destructive">{canvas.error}</p>
            <Button variant="outline" onClick={canvas.retry}>
              重新加载
            </Button>
          </div>
        )}
        {selected && !canvas.loading && !canvas.error && (
          <aside
            className="absolute bottom-[112px] left-4 z-10 w-[230px] max-w-[calc(100%-2rem)] rounded-xl border border-border bg-white/95 p-4 shadow-lg backdrop-blur-sm sm:bottom-[68px]"
            aria-label="实体详情"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground">
                  {selected.entityType}
                  {selected.isSeed && ' · 查询实体'}
                </p>
                <h3 className="mt-1 break-words text-sm font-semibold">
                  {selected.label}
                </h3>
              </div>
              <button
                type="button"
                aria-label="关闭实体详情"
                className="rounded p-1 text-muted-foreground hover:bg-muted"
                onClick={() => canvas.setSelectedId(null)}
              >
                <Icon name="close" width={14} height={14} />
              </button>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              出现在 {selected.pathCount} 条路径中
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {selected.documentIds.map((id, index) => (
                <Link
                  key={id}
                  to={`/documents/${id}`}
                  className="text-[11px] font-medium text-primary hover:underline"
                >
                  来源文档 {index + 1} ↗
                </Link>
              ))}
            </div>
          </aside>
        )}
        <div className="absolute bottom-4 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-2">
          <select
            aria-label="选择图谱实体"
            className="h-9 min-w-0 max-w-[180px] rounded-lg border border-border bg-white px-2.5 text-[11px] text-muted-foreground shadow-sm"
            value={selected ? (canvas.selectedId ?? '') : ''}
            onChange={(event) =>
              canvas.setSelectedId(event.target.value || null)
            }
          >
            <option value="">选择实体查看详情</option>
            {dataset.data.nodes?.map((node) => (
              <option key={node.id} value={node.id}>
                {String(node.data?.label)}
              </option>
            ))}
          </select>
          <div className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-white p-1 shadow-sm">
            <button
              type="button"
              className="graph-control"
              aria-label="缩小关系图"
              title="缩小"
              disabled={canvas.loading || !!canvas.error}
              onClick={canvas.zoomOut}
            >
              <Icon name="minus" width={15} height={15} />
            </button>
            <span
              className="w-10 text-center font-mono text-[10px] tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              {Math.round(canvas.zoom * 100)}%
            </span>
            <button
              type="button"
              className="graph-control"
              aria-label="放大关系图"
              title="放大"
              disabled={canvas.loading || !!canvas.error}
              onClick={canvas.zoomIn}
            >
              <Icon name="plus" width={15} height={15} />
            </button>
            <span className="mx-1 h-4 w-px bg-border" />
            <button
              type="button"
              className="graph-control"
              aria-label="居中并适配关系图"
              title="居中并适配"
              disabled={canvas.loading || !!canvas.error}
              onClick={canvas.fit}
            >
              <Icon name="fit" width={15} height={15} />
            </button>
          </div>
        </div>
      </div>
      <footer className="flex flex-wrap justify-between gap-2 border-t border-border bg-white px-5 py-3 text-[10px] text-muted-foreground">
        <span>拖动节点调整位置 · 滚轮缩放 · 点击节点查看来源</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full bg-primary/60" />
          当前路径
        </span>
      </footer>
    </section>
  );
}
