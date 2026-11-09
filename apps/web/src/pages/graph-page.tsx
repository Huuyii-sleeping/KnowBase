import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/ui/icon';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { graphApi, type GraphSearchPath } from '@/lib/api';
import { isMockEnabled } from '@/lib/mock-api';
import { KnowledgeGraphDiagram } from '@/components/knowledge-graph-diagram';
import { GraphPathPanel } from '@/components/graph-path-panel';

const EXAMPLES = ['RAG', 'Ollama', 'RabbitMQ', 'KnowBase', 'Neo4j'];

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

  const activePath = useMemo(
    () => items[activeIndex] ?? null,
    [items, activeIndex],
  );

  const runSearch = useCallback(
    async (value: string, hops: string, maxCount: string) => {
      const current = ++requestId.current;
      setLoading(true);
      setError(null);
      setSearched(value);
      try {
        const result = await graphApi.search(
          value,
          Number(hops),
          Number(maxCount),
        );
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
    },
    [],
  );

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
    setParams(
      value
        ? {
            ...(isMockEnabled() ? { mock: '1' } : {}),
            q: value,
            maxHops,
            limit,
          }
        : {},
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Knowledge graph"
        title="知识图谱"
        description="连接分散的知识，探索实体之间的关系与来源。"
        actions={
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
        }
      />

      <form className="workspace-search" onSubmit={submit}>
        <Input
          aria-label="图谱查询"
          className="h-11 flex-1 border-0 bg-transparent shadow-none"
          placeholder="输入实体名，例如 Ollama、RabbitMQ、Neo4j…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" size="lg" disabled={!query.trim() || loading}>
          <Icon name="graph" width={16} height={16} />
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
            onClick={() =>
              setParams({
                ...(isMockEnabled() ? { mock: '1' } : {}),
                q: example,
                maxHops,
                limit,
              })
            }
          >
            {example}
          </Button>
        ))}
      </div>

      {!searched && !loading && (
        <EmptyState
          icon="graph"
          title="每个知识点，都有它的连接"
          description="输入实体名或选择上方示例，展开它的关联路径，追溯知识来自哪份文档。"
        />
      )}
      {loading && (
        <div className="border border-border bg-background py-20 text-center text-[13px] text-muted-foreground">
          正在查询图谱…
        </div>
      )}
      {error && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          图谱查询失败：{error}
        </div>
      )}
      {!loading && !error && searched && items.length === 0 && (
        <EmptyState
          icon="graph"
          title="没有找到图谱路径"
          description="换一个实体名，或调整多跳范围。"
        />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_260px] xl:grid-cols-[minmax(0,1fr)_240px]">
          <KnowledgeGraphDiagram
            paths={items}
            activePath={activePath}
            query={searched}
          />
          <GraphPathPanel
            paths={items}
            activeIndex={activeIndex}
            onSelect={setActiveIndex}
          />
        </div>
      )}
    </div>
  );
}
