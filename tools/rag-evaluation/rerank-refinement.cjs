// Offline ablations only: original bodies, fixed pools, and no gold labels.
const { reserveRuleAnchors } = require('./rerank-anchor.cjs');
const { orderSelected } = require('./rerank-order-replay.cjs');

function selectVariant(row, scores, variant, constraints) {
  const selection = reserveRuleAnchors(row, { scores }, {
    ...constraints,
    ...variant.constraints,
    anchorCount: variant.anchorCount ?? 2,
  });
  return orderSelected(
    { ...selection, elapsedMs: 0 },
    { decisions: row.pool.map((item, i) => ({ chunkId: item.chunkId, score: scores[i] })) },
  );
}

function refine(original, protocol, scoredRows = null) {
  const lookup = new Map();
  for (const item of scoredRows ?? []) {
    const key = item.source + '/' + item.id;
    if (lookup.has(key)) throw new Error('Duplicate score row');
    lookup.set(key, item);
  }
  return original.sources.map((source) => ({
    ...source,
    rows: source.rows.filter((row) => !scoredRows || lookup.has(source.id + '/' + row.id))
      .map((row) => {
        const supplied = lookup.get(source.id + '/' + row.id);
        if (supplied && JSON.stringify(supplied.chunk_ids) !== JSON.stringify(row.pool.map(p => p.chunkId)))
          throw new Error('Score candidate identity differs');
        const variants = supplied ? protocol.input_variants : protocol.selection_variants;
        const frozenScores = new Map(row.options['bge-m3'].decisions.map(d => [d.chunkId, d.score]));
        const options = Object.fromEntries(variants.map(variant => {
          const scores = supplied ? supplied.variants[variant.id].scores : row.pool.map(p => frozenScores.get(p.chunkId));
          return [variant.id, selectVariant(row, scores, variant, protocol.constraints)];
        }));
        return { ...row, options: {
          rule: row.options.rule,
          current: row.options['bge-m3-anchor2-model-order'],
          ...options,
        } };
      }),
  })).filter(s => s.rows.length);
}

if (require.main === module) {
  const fs = require('node:fs');
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const [protocolFile, output, scores] = process.argv.slice(2);
  const protocol = read(protocolFile);
  const { createHash } = require('node:crypto');
  for (const [file, hash] of Object.entries(protocol.files_sha256)) {
    if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash)
      throw new Error('Refinement fingerprint differs: ' + file);
  }
  const scored = scores ? read(scores) : null;
  if (scored && (!scored.complete || scored.protocol_sha256 !== require('./rerank-model-replay.cjs').fingerprint(protocol)))
    throw new Error('Incomplete or foreign protocol scores');
  if (scored && JSON.stringify(scored.rows.map(r => ({ source: r.source, id: r.id }))) !== JSON.stringify(protocol.input_cases))
    throw new Error('Incomplete or reordered input cases');
  fs.writeFileSync(output, JSON.stringify({ sources: refine(read(protocol.replay), protocol, scored?.rows) }) + '\n', { flag: 'wx' });
}

module.exports = { selectVariant, refine };
