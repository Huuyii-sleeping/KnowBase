import type { estypes } from '@elastic/elasticsearch';

export type KeywordPolicy = 'combined' | 'weighted' | 'body-reserve';

export function keywordPolicy(value: string): KeywordPolicy {
  if (!['combined', 'weighted', 'body-reserve'].includes(value))
    throw new Error(
      'RAG_KEYWORD_POLICY must be combined, weighted or body-reserve',
    );
  return value as KeywordPolicy;
}

/** Keep the original body statistics independent of the contextual text. */
export function keywordMatch(
  query: string,
  cjk: boolean,
  contextual: boolean,
  policy: KeywordPolicy,
): estypes.QueryDslQueryContainer {
  const suffix = cjk ? '.cjk' : '';
  if (!contextual) return { match: { [`content${suffix}`]: { query } } };
  if (policy === 'weighted')
    return {
      multi_match: {
        query,
        fields: [`content${suffix}^2`, `retrieval_text${suffix}`],
        type: 'best_fields',
        tie_breaker: 0.1,
      },
    };
  return { match: { [`retrieval_text${suffix}`]: { query } } };
}

/** Two body slots, then one context slot; duplicates never consume a slot. */
export function reserveBodyCandidates<
  T extends { id: string; score: number | null },
>(body: T[], context: T[], limit: number): T[] {
  const positions = [0, 0];
  const lists = [body, context];
  const selected: T[] = [];
  const seen = new Set<string>();
  const take = (route: number): boolean => {
    const list = lists[route];
    while (positions[route] < list.length) {
      const candidate = list[positions[route]++];
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      selected.push(candidate);
      return true;
    }
    return false;
  };
  let slot = 0;
  while (selected.length < limit) {
    const route = slot++ % 3 === 2 ? 1 : 0;
    if (!take(route) && !take(1 - route)) break;
  }
  return selected;
}
