import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchModeTabs } from '@/components/search-mode-tabs';
import { HybridResultCard, KeywordResultCard, SemanticResultCard } from '@/components/search-result-card';
import {
  searchApi,
  type HybridSearchItem,
  type SearchDocumentItem,
  type SearchMode,
  type SemanticSearchItem,
} from '@/lib/api';
import { normalizeSearchMode, SEARCH_MODES } from '@/lib/search-result.utils';
import { useSearchParams } from 'react-router-dom';

type SearchResult = SearchDocumentItem | SemanticSearchItem | HybridSearchItem;

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? '');
  const [mode, setMode] = useState<SearchMode>(normalizeSearchMode(params.get('mode')));
  const [topK, setTopK] = useState('5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const requestSequence = useRef(0);

  const activeMode = useMemo(
    () => SEARCH_MODES.find((item) => item.value === mode) ?? SEARCH_MODES[0],
    [mode],
  );

  const runSearch = async (query: string, selectedMode: SearchMode = mode) => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setSearched(query);

    try {
      if (selectedMode === 'keyword') {
        const result = await searchApi.documents(query);
        if (requestId !== requestSequence.current) return;
        setResults(result.items);
        setTotal(result.total);
      } else if (selectedMode === 'semantic') {
        const result = await searchApi.semantic(query, Number(topK));
        if (requestId !== requestSequence.current) return;
        setResults(result.items);
        setTotal(result.items.length);
      } else {
        const result = await searchApi.hybrid(query, Number(topK));
        if (requestId !== requestSequence.current) return;
        setResults(result.items);
        setTotal(result.items.length);
      }
    } catch (reason) {
      if (requestId !== requestSequence.current) return;
      setResults([]);
      setTotal(null);
      setError((reason as Error).message);
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
      setSearched('');
      setResults([]);
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
    setMode(nextMode);
    if (searched) setParams({ q: searched, mode: nextMode });
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Retrieval workspace</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">检索工作台</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">定位已发布知识，查看召回依据与排序结果。</p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>召回数量</span>
            <Select value={topK} onValueChange={setTopK}>
              <SelectTrigger className="w-[92px]" aria-label="召回数量"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Top 3</SelectItem>
                <SelectItem value="5">Top 5</SelectItem>
                <SelectItem value="8">Top 8</SelectItem>
                <SelectItem value="10">Top 10</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <form className="flex gap-2" onSubmit={submit}>
        <Input aria-label="检索问题" className="h-10 flex-1" placeholder="输入关键词或自然语言问题…" value={input} onChange={(event) => setInput(event.target.value)} />
        <Button type="submit" size="lg" disabled={!input.trim() || loading}>{loading ? '检索中…' : '开始检索'}</Button>
      </form>

      <SearchModeTabs value={mode} onChange={changeMode} />

      {!searched && !loading && (
        <div className="border border-dashed border-border bg-background py-20 text-center">
          <div className="text-[14px] font-medium">输入一个问题开始检索</div>
          <div className="mt-2 text-[12.5px] text-muted-foreground">可切换检索模式，对比全文、语义和混合召回结果。</div>
        </div>
      )}
      {loading && <div className="border border-border bg-background py-20 text-center text-[13px] text-muted-foreground">正在从已发布知识中检索…</div>}
      {error && <div className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">检索失败：{error}</div>}
      {!loading && !error && searched && results.length === 0 && (
        <div className="border border-dashed border-border bg-background py-20 text-center">
          <div className="text-[14px] font-medium">没有找到匹配结果</div>
          <div className="mt-2 text-[12.5px] text-muted-foreground">尝试换一种说法，或切换检索模式。</div>
        </div>
      )}
      {!loading && !error && searched && results.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
            <span className="text-[13px] font-medium">“{searched}”</span>
            <span className="text-[12px] text-muted-foreground">{activeMode.label}</span>
            <span className="ml-auto text-[12px] text-muted-foreground">{total ?? results.length} 条结果</span>
          </div>
          <div className="px-4 sm:px-5">
            {mode === 'keyword' && (results as SearchDocumentItem[]).map((item) => <KeywordResultCard key={item.id} item={item} />)}
            {mode === 'semantic' && (results as SemanticSearchItem[]).map((item) => <SemanticResultCard key={item.chunkId} item={item} />)}
            {mode === 'hybrid' && (results as HybridSearchItem[]).map((item, index) => <HybridResultCard key={`${item.documentId}-${item.chunkId ?? index}`} item={item} />)}
          </div>
        </section>
      )}
    </div>
  );
}
