import { describe, expect, it } from 'vitest';
import { formatScore, getHybridSources, getKeywordHighlight, normalizeSearchMode } from './search-result.utils';

describe('search result utilities', () => {
  it('normalizes unsupported URL modes to hybrid retrieval', () => {
    expect(normalizeSearchMode('semantic')).toBe('semantic');
    expect(normalizeSearchMode('unsupported')).toBe('hybrid');
    expect(normalizeSearchMode(null)).toBe('hybrid');
  });

  it('formats missing and numeric scores consistently', () => {
    expect(formatScore(0.77421)).toBe('0.774');
    expect(formatScore(null)).toBe('—');
    expect(formatScore(undefined)).toBe('—');
  });

  it('prefers content highlights and falls back to title highlights', () => {
    expect(getKeywordHighlight({
      id: 'doc-1',
      title: '标题',
      score: 1,
      highlights: { content: ['正文 <em>命中</em>'], title: ['标题 <em>命中</em>'] },
    })).toBe('正文 <em>命中</em>');
    expect(getKeywordHighlight({
      id: 'doc-2',
      title: '标题',
      score: 1,
      highlights: { title: ['标题 <em>命中</em>'] },
    })).toBe('标题 <em>命中</em>');
    expect(getKeywordHighlight({
      id: 'doc-3',
      title: '无高亮结果',
      score: null,
    })).toBeUndefined();
  });

  it('recovers source badges when an older hybrid response omits sources', () => {
    expect(getHybridSources({
      documentId: 'doc-1',
      title: '混合结果',
      category: null,
      team: null,
      tags: [],
      score: 1,
      keywordScore: 0.8,
      semanticScore: 0.7,
      rerankScore: 0.9,
    })).toEqual(['keyword', 'semantic']);
    expect(getHybridSources({
      documentId: 'doc-2',
      title: '无来源结果',
      category: null,
      team: null,
      tags: [],
      score: 1,
      keywordScore: null,
      semanticScore: null,
      rerankScore: 0.1,
    })).toEqual(['semantic']);
  });
});
