import { RerankableCandidate } from './rerank.types';

export const candidate = (
  id: string,
  keywordScore = 1,
): RerankableCandidate => ({
  chunkId: id,
  documentId: id,
  title: '证据',
  content: '正文证据',
  category: null,
  team: null,
  tags: [],
  score: keywordScore,
  keywordScore,
  semanticScore: null,
  sources: ['keyword'],
});
