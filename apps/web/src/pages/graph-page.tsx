import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { graphApi, type GraphSearchPath } from '@/lib/api';
import { getGraphPathDocumentIds, getGraphPathNodeCount, getGraphPathRelationCount } from '@/lib/graph-result.utils';
import { cn } from '@/lib/utils';

const EXAMPLES = ['Ollama', 'RabbitMQ', 'KnowBase', 'Neo4j'];

function PathCard({ path, active, onClick }: { path: GraphSearchPath; active: boolean; onClick: () => void }) {
  const entityNames = path.entities.map((entity) => entity.name).join(' → ');
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-md border px-3 py-3 text-left transition-colors',
        active ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-accent',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium">{path.seed.name}</span>
        <span className="text-[11px] text-muted-foreground">{path.seed.type}</span>
      </div>
      <div className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{entityNames || '无多跳路径'}</div>
      <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
        <span>{getGraphPathNodeCount(path)} 个实体</span>
        <span>{getGraphPathRelationCount(path)} 条关系</span>
        <span>{getGraphPathDocumentIds(path).length} 篇文档</span>
      </div>
    </button>
  );
}

export function GraphPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [maxHops, setMaxHops] = useState(params.get('maxHops') ?? '2');
  const [limit, setLimit] = useState(params.get('limit') ?? '12');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState('');
  const [items, setItems] = useState<GraphSearchPath[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const requestId = useRef(0);

  const activePath = useMemo(() => items[activeIndex] ?? null, [items, activeIndex]);

  const runSearch = useCallback(async (value: string, hops: string, maxCount: string) => {
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    setSearched(value);
    try {
      const result = await graphApi.search(value, Number(hops), Number(maxCount));
      if (current !== requestId.current) return;
      setItems(result.items);
      setActiveIndex(0);
    } catch (e) {
      if (current !== requestId.current) return;
      setItems([]);
      setActiveIndex(0);
      setError((e as Error).message);
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const nextQuery = params.get('q')?.trim() ?? '';
    const nextHops = params.get('maxHops') ?? '2';
    const nextLimit = params.get('limit') ?? '12';
    setQuery(nextQuery);
    setMaxHops(nextHops);
    setLimit(nextLimit);
    if (!nextQuery) {
      setSearched('');
      setItems([]);
      setActiveIndex(0);
      setError(null);
      return;
    }
    void runSearch(nextQuery, nextHops, nextLimit);
  }, [params, runSearch]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    setParams(value ? { q: value, maxHops, limit } : {});
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Graph workspace</div>
          <h1 className="text-[22px] font-semibold tracking-tight">知识图谱</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">按实体追踪文档、Chunk 和关系来源。</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>多跳</span>
          <Select value={maxHops} onValueChange={setMaxHops}>
            <SelectTrigger className="w-[88px]" aria-label="多跳层数">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 跳</SelectItem>
              <SelectItem value="2">2 跳</SelectItem>
              <SelectItem value="3">3 跳</SelectItem>
            </SelectContent>
          </Select>
          <span>结果</span>
          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger className="w-[88px]" aria-label="结果数量">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">6 条</SelectItem>
              <SelectItem value="12">12 条</SelectItem>
              <SelectItem value="20">20 条</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <form className="flex gap-2" onSubmit={submit}>
        <Input
          aria-label="图谱查询"
          className="h-10 flex-1"
          placeholder="输入实体名，例如 Ollama、RabbitMQ、Neo4j…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" size="lg" disabled={!query.trim() || loading}>
          {loading ? '查询中…' : '开始查询'}
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <Button
            key={example}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setParams({ q: example, maxHops, limit })}
          >
            {example}
          </Button>
        ))}
      </div>

      {!searched && !loading && (
        <div className="border border-dashed border-border bg-background py-20 text-center">
          <div className="text-[14px] font-medium">输入一个实体开始追踪</div>
          <div className="mt-2 text-[12.5px] text-muted-foreground">查询会返回包含该实体的图谱路径，并标出来源文档。</div>
        </div>
      )}
      {loading && <div className="border border-border bg-background py-20 text-center text-[13px] text-muted-foreground">正在查询图谱…</div>}
      {error && <div className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">图谱查询失败：{error}</div>}
      {!loading && !error && searched && items.length === 0 && (
        <div className="border border-dashed border-border bg-background py-20 text-center">
          <div className="text-[14px] font-medium">没有找到图谱路径</div>
          <div className="mt-2 text-[12.5px] text-muted-foreground">换一个实体名，或缩小/扩大多跳范围。</div>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className="space-y-2">
            {items.map((path, index) => (
              <PathCard key={`${path.seed.key}-${index}`} path={path} active={activeIndex === index} onClick={() => setActiveIndex(index)} />
            ))}
          </section>

          <section className="rounded-lg border border-border bg-background">
            {activePath && (
              <>
                <div className="border-b border-border px-4 py-3">
                  <div className="text-[13px] font-medium">{activePath.seed.name}</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">{activePath.seed.type} · {getGraphPathRelationCount(activePath)} 条关系</div>
                </div>

                <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="rounded-md border border-border p-4">
                    <div className="mb-3 text-[12px] font-medium text-muted-foreground">路径</div>
                    <div className="space-y-3">
                      {activePath.entities.map((entity, index) => (
                        <div key={entity.key} className="flex items-center gap-2">
                          <span className="flex h-7 min-w-7 items-center justify-center rounded-md bg-primary/10 px-2 text-[11px] font-semibold text-primary">{index + 1}</span>
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium">{entity.name}</div>
                            <div className="text-[11px] text-muted-foreground">{entity.type}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-md border border-border p-4">
                      <div className="text-[12px] font-medium text-muted-foreground">来源文档</div>
                      <div className="mt-2 flex flex-col gap-2">
                        {getGraphPathDocumentIds(activePath).map((documentId) => (
                          <Link key={documentId} to={`/documents/${documentId}`} className="rounded-md border border-border px-3 py-2 text-[12.5px] hover:bg-accent">
                            {documentId}
                          </Link>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-md border border-border p-4">
                      <div className="text-[12px] font-medium text-muted-foreground">关系</div>
                      <div className="mt-2 space-y-2">
                        {activePath.relations.map((relation) => (
                          <div key={relation.key} className="rounded-md bg-secondary px-3 py-2 text-[12px]">
                            <div className="font-medium">{relation.type}</div>
                            <div className="mt-0.5 text-muted-foreground">{relation.documentId} · {relation.chunkId}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
