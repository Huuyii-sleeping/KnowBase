import { Link } from 'react-router-dom';
import type { GraphSearchPath } from '@/lib/api';
import { getGraphPathDocumentIds } from '@/lib/graph-result.utils';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

export function GraphPathPanel({
  paths,
  activeIndex,
  onSelect,
}: {
  paths: GraphSearchPath[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const active = paths[activeIndex];
  return (
    <aside className="min-w-0 space-y-4" aria-label="关系路径">
      <section className="overflow-hidden rounded-xl border border-border bg-white">
        <header className="flex items-center justify-between border-b border-border px-4 py-4">
          <h2 className="text-xs font-semibold">发现的路径</h2>
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {paths.length} 条
          </span>
        </header>
        <div className="max-h-[280px] space-y-2 overflow-y-auto p-3">
          {paths.map((path, index) => (
            <button
              key={`${path.seed.key}-${index}`}
              type="button"
              aria-pressed={index === activeIndex}
              onClick={() => onSelect(index)}
              className={cn(
                'w-full rounded-lg border p-3 text-left transition-colors',
                index === activeIndex
                  ? 'border-primary/30 bg-accent/60'
                  : 'border-transparent hover:bg-muted',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold">
                  {path.entities[0]?.name || path.seed.name}{' '}
                  <span className="mx-1 text-muted-foreground/50">→</span>{' '}
                  {path.entities.at(-1)?.name}
                </span>
                <Icon
                  name="chevron"
                  width={12}
                  height={12}
                  className="shrink-0 text-muted-foreground"
                />
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {path.relations.length} 条关系 ·{' '}
                {getGraphPathDocumentIds(path).length} 篇来源文档
              </p>
            </button>
          ))}
        </div>
      </section>
      {active && (
        <section className="rounded-xl border border-border bg-white p-4">
          <h2 className="mb-5 text-xs font-semibold">沿路径探索</h2>
          <ol>
            {active.entities.map((entity, index) => (
              <li key={`${entity.key}-${index}`} className="relative pl-5">
                <span
                  className={cn(
                    'absolute left-0 top-1 h-2.5 w-2.5 rounded-full border-2',
                    index === 0
                      ? 'border-primary bg-primary'
                      : 'border-primary/45 bg-white',
                  )}
                />
                {index < active.entities.length - 1 && (
                  <span className="absolute bottom-0 left-[4px] top-4 w-px bg-border" />
                )}
                <p className="break-words text-[12px] font-medium">
                  {entity.name}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {entity.type}
                </p>
                {active.relations[index] && (
                  <p className="flex items-center gap-1 py-4 text-[10px] text-primary">
                    <span>↓</span>
                    {active.relations[index].type}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 text-[10px] text-muted-foreground">
              回到知识来源
            </p>
            {getGraphPathDocumentIds(active).map((id, index) => (
              <Link
                key={id}
                to={`/documents/${id}`}
                className="mt-2 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-[11px] text-primary hover:bg-accent"
              >
                <Icon name="file" width={14} height={14} />
                查看来源文档 {index + 1}
                <span className="ml-auto">↗</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
