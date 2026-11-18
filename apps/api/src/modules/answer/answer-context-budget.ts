import { HybridSearchItem } from '../search/hybrid-search.service';

// Keep complete passages and their citation identities; never cut a condition in half.
export function fitAnswerContexts(
  items: HybridSearchItem[],
  limit: number,
): HybridSearchItem[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw new Error('Answer context limit must be 1..5');
  }
  const selected: HybridSearchItem[] = [];
  const identities = new Set<string>();
  const bodies = new Set<string>();
  let characters = 0;
  for (const item of items) {
    const content = item.content?.trim();
    if (!content) continue;
    const identity = JSON.stringify([
      item.documentId,
      item.chunkId ?? null,
      content,
    ]);
    const body = JSON.stringify([item.documentId, content]);
    if (identities.has(identity) || bodies.has(body)) continue;
    const size = item.content!.length;
    if (characters + size > 6000 && selected.length > 0) continue;
    selected.push(item);
    identities.add(identity);
    bodies.add(body);
    characters += size;
    if (selected.length >= limit) break;
  }
  return selected;
}
