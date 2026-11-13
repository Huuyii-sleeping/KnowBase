// Conservative, extractive experiment: no model, synonym expansion or query rewrite.
const QUESTION =
  /什么|哪|如何|怎么|怎样|是否|能否|会不会|多久|多少|谁|吗|为何|为什么|能不能|是不是/;
const OPEN = new Map([
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['（', '）'],
  ['(', ')'],
  ['[', ']'],
  ['【', '】'],
  ['"', '"'],
]);
const CLOSE = new Set(OPEN.values());

function splitIntents(query) {
  if (typeof query !== 'string' || !query.trim())
    throw new Error('Multi-intent query must be non-empty');
  const original = query.trim();
  if (original.length > 512 || original.includes('`')) return [original];
  const parts = [],
    stack = [];
  let start = 0;
  for (let i = 0; i < original.length; i++) {
    const char = original[i];
    if (stack.at(-1) === char) stack.pop();
    else if (OPEN.has(char)) stack.push(OPEN.get(char));
    else if (CLOSE.has(char)) return [original];
    else if (!stack.length && '，；？'.includes(char)) {
      const part = original.slice(start, i).trim();
      if (part) parts.push(part);
      start = i + 1;
    }
  }
  const tail = original
    .slice(start)
    .replace(/[?。！!]+$/, '')
    .trim();
  if (tail) parts.push(tail);
  if (
    stack.length ||
    parts.length !== 2 ||
    parts.some((p) => p.length < 6 || !QUESTION.test(p))
  )
    return [original];
  if (new Set(parts).size !== 2 || parts.includes(original)) return [original];
  return [original, ...parts];
}

function queryMode(value) {
  if (!['off', 'clauses-keyword', 'clauses-both'].includes(value))
    throw new Error('Invalid multi-intent query mode');
  return value;
}

function planQueries(query, budget, enabled) {
  if (!Number.isInteger(budget) || budget < 1 || budget > 100)
    throw new Error('Multi-intent budget must be an integer in 1..100');
  const queries = enabled ? splitIntents(query) : [query.trim()];
  // RagQueryService reads min(3 * budget, 100) hits per invocation. Splitting
  // must not multiply that cap. Budgets below three cannot fund three queries.
  const units = Math.floor(Math.min(budget * 3, 100) / 3);
  if (queries.length === 1 || units < 3) return [{ query: queries[0], budget }];
  const original = Math.min(Math.ceil(units / 2), units - 2),
    rest = units - original;
  return queries.map((text, i) => ({
    query: text,
    budget:
      i === 0 ? original : i === 1 ? Math.ceil(rest / 2) : Math.floor(rest / 2),
  }));
}

module.exports = { splitIntents, queryMode, planQueries };
