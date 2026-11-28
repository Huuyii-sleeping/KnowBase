import { requestFailure, type RequestFailureInfo } from '@/lib/api-error';
import { RequestFailure } from '@/components/request-failure';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/ui/icon';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchModeTabs } from '@/components/search-mode-tabs';
import {
  HybridResultCard,
  KeywordResultCard,
  SemanticResultCard,
} from '@/components/search-result-card';
import {
  searchApi,
  type HybridSearchItem,
  type SearchDocumentItem,
  type SearchMode,
  type SemanticSearchItem,
} from '@/lib/api';
import {
  isSearchResultCurrent,
  normalizeSearchMode,
  SEARCH_MODES,
} from '@/lib/search-result.utils';
import { useSearchParams } from 'react-router-dom';

type SearchResult = SearchDocumentItem | SemanticSearchItem | HybridSearchItem;

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? '');
  const [mode, setMode] = useState<SearchMode>(
    normalizeSearchMode(params.get('mode')),
  );
  const [topK, setTopK] = useState('5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<
    | (RequestFailureInfo & { query: string; mode: SearchMode; topK: number })
    | null
  >(null);
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultMode, setResultMode] = useState<SearchMode | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const requestSequence = useRef(0);

  const activeMode = useMemo(
    () => SEARCH_MODES.find((item) => item.value === mode) ?? SEARCH_MODES[0],
    [mode],
  );

  const runSearch = async (
    query: string,
    selectedMode: SearchMode = mode,
    recall = Number(topK),
  ) => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setSearched(query);

    try {
      if (selectedMode === 'keyword') {
        const result = await searchApi.documents(query);
        if (requestId !== requestSequence.current) return;
        setResults(result.items);
        setResultMode(selectedMode);
        setTotal(result.total);
      } else if (selectedMode === 'semantic') {
        const result = await searchApi.semantic(query, recall);
        if (requestId !== requestSequence.current) return;
        setResults(result.items);
        setResultMode(selectedMode);
        setTotal(result.items.length);
      } else {
        const result = await searchApi.hybrid(query, recall);
        if (requestId !== requestSequence.current) return;
        setResults(result.items);
        setResultMode(selectedMode);
        setTotal(result.items.length);
      }
    } catch (reason) {
      if (requestId !== requestSequence.current) return;
      setResults([]);
      setResultMode(null);
      setTotal(null);
      setError({
        ...requestFailure(reason),
        query,
        mode: selectedMode,
        topK: recall,
      });
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    const query = params.get('q')?.trim() ?? '';
    const nextMode = normalizeSearchMode(params.get('mode'));
    setInput(query);
    setMode(nextMode);
    if (!query) {
      requestSequence.current += 1;
      setLoading(false);
      setError(null);
      setSearched('');
      setResults([]);
      setResultMode(null);
      setTotal(null);
      return;
    }
    void runSearch(query, nextMode);
    // URL changes are the explicit search action; mode is read from the URL here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = input.trim();
    setParams(query ? { q: query, mode } : {});
  };

  const changeMode = (nextMode: SearchMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setResults([]);
    setResultMode(null);
    setTotal(null);
    setError(null);
    if (searched) {
      setLoading(true);
      setParams({ q: searched, mode: nextMode });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Search workspace"
        title="检索工作台"
        description="从关键词到完整问题，找到你需要的知识与原文。"
        actions={
          <div className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>召回数量</span>
            <Select value={topK} onValueChange={setTopK}>
              <SelectTrigger className="w-[92px]" aria-label="召回数量">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Top 3</SelectItem>
                <SelectItem value="5">Top 5</SelectItem>
                <SelectItem value="8">Top 8</SelectItem>
                <SelectItem value="10">Top 10</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <form className="workspace-search" onSubmit={submit}>
        <Input
          aria-label="检索问题"
          className="h-11 flex-1 border-0 bg-transparent shadow-none"
          placeholder="输入关键词或自然语言问题…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <Button type="submit" size="lg" disabled={!input.trim() || loading}>
          <Icon name="search" width={16} height={16} />
          {loading ? '检索中…' : '开始检索'}
        </Button>
      </form>

      <SearchModeTabs value={mode} onChange={changeMode} />

      {!searched && !loading && (
        <EmptyState
          icon="search"
          title="从一个关键词，找到更多"
          description="输入关键词或完整问题，使用混合、全文或语义检索查找已发布的知识。"
        />
      )}
      {loading && (
        <div className="border border-border bg-background py-20 text-center text-[13px] text-muted-foreground">
          正在从已发布知识中检索…
        </div>
      )}
      {error && (
        <RequestFailure
          title="暂时无法完成检索"
          failure={error}
          onRetry={() => void runSearch(error.query, error.mode, error.topK)}
          onRefresh={() => void runSearch(error.query, error.mode, error.topK)}
        />
      )}
      {!loading && !error && searched && results.length === 0 && (
        <EmptyState
          icon="search"
          title="没有找到匹配结果"
          description="尝试换一种说法，或切换检索模式。"
        />
      )}
      {!loading &&
        !error &&
        searched &&
        results.length > 0 &&
        isSearchResultCurrent(resultMode, mode) && (
          <section className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
              <span className="text-[13px] font-medium">“{searched}”</span>
              <span className="text-[12px] text-muted-foreground">
                {activeMode.label}
              </span>
              <span className="ml-auto text-[12px] text-muted-foreground">
                {total ?? results.length} 条结果
              </span>
            </div>
            <div className="px-4 sm:px-5">
              {mode === 'keyword' &&
                (results as SearchDocumentItem[]).map((item) => (
                  <KeywordResultCard key={item.id} item={item} />
                ))}
              {mode === 'semantic' &&
                (results as SemanticSearchItem[]).map((item) => (
                  <SemanticResultCard key={item.chunkId} item={item} />
                ))}
              {mode === 'hybrid' &&
                (results as HybridSearchItem[]).map((item, index) => (
                  <HybridResultCard
                    key={`${item.documentId}-${item.chunkId ?? index}`}
                    item={item}
                  />
                ))}
            </div>
          </section>
        )}
    </div>
  );
}
