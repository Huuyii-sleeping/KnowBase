// Offline selection adapter. Model scores never receive evidence labels.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { selectRanked } = require("./rerank-policies.cjs");

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
// Python's canonical protocol serialization preserves insertion order and UTF-8.
const fingerprint = (value) => hash(JSON.stringify(value));

function modelSelection(row, result, strategy) {
  if (
    !result ||
    result.scores.length !== row.pool.length ||
    result.scores.some((score) => !Number.isFinite(score))
  ) {
    throw new Error("Incomplete or nonfinite model scores");
  }
  const ranked = row.pool
    .map((item, i) => ({ ...item, rerankScore: result.scores[i] }))
    .sort((a, b) => b.rerankScore - a.rerankScore);
  const started = performance.now();
  const selected = selectRanked(ranked, strategy);
  return {
    selected: selected.selected.map((p) => p.chunkId),
    decisions: selected.decisions,
    characters: selected.characters,
    elapsedMs: performance.now() - started,
    inferenceMs: result.elapsed_ms,
    newPairs: result.new_pairs,
    cachedPairs: result.cached_pairs,
    windows: result.diagnostics.reduce((sum, d) => sum + d.windows, 0),
  };
}

function rrfSelection(row, strategy) {
  const decisions = new Map(
    row.options.rrf.decisions.map((d) => [d.chunkId, d]),
  );
  const ranked = row.pool
    .map((p) => ({ ...p, rerankScore: decisions.get(p.chunkId).score }))
    .sort(
      (a, b) => decisions.get(a.chunkId).rank - decisions.get(b.chunkId).rank,
    );
  const started = performance.now();
  const result = selectRanked(ranked, strategy);
  return {
    ...result,
    selected: result.selected.map((p) => p.chunkId),
    elapsedMs: performance.now() - started,
  };
}

async function replay(root, protocol, scoreDirectory) {
  for (const [file, expected] of Object.entries({
    ...protocol.input_files_sha256,
    ...protocol.implementation_sha256,
  })) {
    if (hash(await fs.readFile(path.resolve(root, file))) !== expected)
      throw new Error("Input or implementation fingerprint differs: " + file);
  }
  const original = await read(path.resolve(root, protocol.input_replay));
  const allRows = original.sources.flatMap((s) =>
    s.rows.map((r) => ({ source: s.id, ...r })),
  );
  const models = new Map();
  for (const config of protocol.models) {
    const scored = await read(
      path.join(scoreDirectory, config.id + "-scores.json"),
    );
    if (
      scored.protocol_sha256 !== fingerprint(protocol) ||
      scored.complete !== true ||
      JSON.stringify(scored.model) !== JSON.stringify(config) ||
      scored.rows.length !== allRows.length
    ) {
      throw new Error("Model output fingerprint or completeness differs");
    }
    const lookup = new Map();
    scored.rows.forEach((result, i) => {
      const row = allRows[i];
      if (
        result.source !== row.source ||
        result.id !== row.id ||
        result.pair_keys.length !== row.pool.length ||
        result.pair_keys.some(
          (key, j) =>
            key !==
            fingerprint([
              protocol.queries[row.source][row.id],
              row.pool[j].title,
              row.pool[j].content || "",
            ]),
        )
      ) {
        throw new Error("Model task or candidate identity differs");
      }
      lookup.set(row.source + "/" + row.id, result);
    });
    models.set(config.id, lookup);
  }
  const sources = original.sources.map((source) => ({
    ...source,
    rows: source.rows.map((row) => {
      const options = {};
      for (const strategy of protocol.strategies) {
        options[strategy.id] =
          strategy.kind === "model"
            ? modelSelection(
                row,
                models.get(strategy.id).get(source.id + "/" + row.id),
                strategy,
              )
            : strategy.kind === "rrf" && strategy.id !== "rrf"
              ? rrfSelection(row, strategy)
              : row.options[strategy.id];
      }
      return { ...row, options };
    }),
  }));
  return { protocol_sha256: fingerprint(protocol), sources };
}

if (require.main === module) {
  (async () => {
    const [protocolFile, scoreDirectory, output] = process.argv.slice(2);
    if (!protocolFile || !scoreDirectory || !output)
      throw new Error("usage: protocol score-directory output");
    const result = await replay(
      path.resolve(__dirname, "../.."),
      await read(protocolFile),
      scoreDirectory,
    );
    await fs.writeFile(output, JSON.stringify(result) + "\n", { flag: "wx" });
    console.log(
      JSON.stringify({
        sources: result.sources.length,
        rows: result.sources.reduce((s, r) => s + r.rows.length, 0),
      }),
    );
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { fingerprint, modelSelection, rrfSelection, replay };
