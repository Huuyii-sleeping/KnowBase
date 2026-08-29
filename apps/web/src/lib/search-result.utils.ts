import type {
  AnswerSourceType,
  HybridSearchItem,
  SearchDocumentItem,
  SearchMode,
} from '@/lib/api';

export const SEARCH_MODES: Array<{ value: SearchMode; label: string; description: string }> = [
  { value: 'hybrid', label: '混合检索', description: '全文 + 向量 + 重排' },
  { value: 'keyword', label: '全文检索', description: '标题、正文与标签' },
  { value: 'semantic', label: '语义检索', description: '按语义相似度召回片段' },
];

export function normalizeSearchMode(value: string | null): SearchMode {
  return SEARCH_MODES.some((mode) => mode.value === value)
    ? value as SearchMode
    : 'hybrid';
}

export function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toFixed(3);
}

export function getKeywordHighlight(item: SearchDocumentItem): string | undefined {
  return item.highlights?.content?.[0] ?? item.highlights?.title?.[0];
}

const SOURCE_TYPES: AnswerSourceType[] = ['keyword', 'semantic', 'graph'];

function isSourceType(value: unknown): value is AnswerSourceType {
  return typeof value === 'string' && SOURCE_TYPES.includes(value as AnswerSourceType);
}

export function getHybridSources(item: HybridSearchItem): AnswerSourceType[] {
  const sources = (item as HybridSearchItem & { sources?: unknown }).sources;
  if (Array.isArray(sources)) {
    const validSources = sources.filter(isSourceType);
    if (validSources.length > 0) return validSources;
  }

  // Older API responses may omit `sources`; infer a useful badge from scores.
  const inferred: AnswerSourceType[] = [];
  if (item.keywordScore !== null && item.keywordScore !== undefined) inferred.push('keyword');
  if (item.semanticScore !== null && item.semanticScore !== undefined) inferred.push('semantic');
  return inferred.length > 0 ? inferred : ['semantic'];
}
