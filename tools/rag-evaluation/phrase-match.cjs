const MODES = ['off', 'identifiers', 'identifiers-phrases'];

function phraseMode(value) {
  if (!MODES.includes(value)) throw new Error('Invalid phrase match mode');
  return value;
}

function phraseTargets(query, mode) {
  phraseMode(mode);
  if (typeof query !== 'string' || !query.trim())
    throw new Error('Phrase query must be non-empty');
  if (mode === 'off' || query.length > 512) return [];
  const targets = [];
  const quoted = /“([^“”]+)”|「([^「」]+)」|`([^`]+)`|"([^"\n]+)"/g;
  // Explicitly quoted business phrases; do not invent a business dictionary.
  if (mode === 'identifiers-phrases') {
    for (const match of query.matchAll(quoted)) {
      const text = match.slice(1).find(Boolean).trim();
      if (text.length >= 2 && text.length <= 32)
        targets.push({ text, kind: 'quoted-phrase' });
    }
  }
  const identifiers =
    /\/[A-Za-z0-9_./-]+|[A-Za-z][A-Za-z0-9_]*(?:[./:=+-][A-Za-z0-9_]+)*/g;
  for (const match of query.matchAll(identifiers)) {
    const text = match[0];
    if (text.length < 2 || text.length > 64) continue;
    if (/[0-9_./:=+-]|[a-z][A-Z]/.test(text) || /^[A-Z]{2,}$/.test(text))
      targets.push({ text, kind: 'identifier' });
  }
  return [...new Map(targets.map((t) => [t.text, t])).values()].slice(0, 4);
}

// Keep the original match mandatory and the generation filter untouched.
// match_phrase is analyzer-level adjacency, not byte-exact punctuation equality.
function phraseRequest(request, mode) {
  phraseMode(mode);
  if (mode === 'off') return request;
  const original = request.query?.bool?.must?.[0];
  const entries = Object.entries(original?.match || {});
  if (
    entries.length !== 1 ||
    !['content.cjk', 'retrieval_text.cjk'].includes(entries[0][0])
  )
    throw new Error('Phrase experiment requires a single CJK keyword field');
  const [field, value] = entries[0];
  const targets = phraseTargets(value.query, mode);
  if (!targets.length) return request;
  return {
    ...request,
    query: {
      bool: {
        ...request.query.bool,
        must: [
          {
            bool: {
              must: [original],
              should: targets.map(({ text }) => ({
                match_phrase: { [field]: { query: text, slop: 0, boost: 2 } },
              })),
              minimum_should_match: 0,
            },
          },
        ],
      },
    },
  };
}

module.exports = { MODES, phraseMode, phraseTargets, phraseRequest };
