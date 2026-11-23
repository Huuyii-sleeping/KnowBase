import { HybridSearchItem } from '../search/hybrid-search.service';

export function source(
  id: string,
  content: string,
  overrides: Partial<HybridSearchItem> = {},
): HybridSearchItem {
  return {
    documentId: `doc-${id}`,
    chunkId: `chunk-${id}`,
    title: '知识条目',
    content,
    category: null,
    team: null,
    tags: [],
    score: 0.8,
    keywordScore: null,
    semanticScore: 0.8,
    sources: ['semantic'],
    rerankScore: 0.8,
    ...overrides,
  };
}

export function answerOutput(text: string, quote: string, sourceId = 'S1') {
  return JSON.stringify({
    status: 'answered',
    claims: [{ text, evidence: [{ sourceId, quote }] }],
  });
}

export function refusalOutput(
  status: 'insufficient' | 'conflict' = 'insufficient',
) {
  return JSON.stringify({ status, claims: [] });
}
