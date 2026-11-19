// Compare long/short model inputs under the same approved document cap.
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { fingerprint } = require("./rerank-model-replay.cjs");
const { selectVariant } = require("./rerank-refinement.cjs");

function validateScoreRows(original, scores, queries) {
  const rows = original.sources.flatMap((s) =>
    s.rows.map((r) => ({ source: s.id, ...r })),
  );
  if (scores.complete !== true || scores.rows.length !== rows.length)
    throw new Error("Incomplete model scores");
  scores.rows.forEach((result, i) => {
    const row = rows[i];
    if (
      result.source !== row.source ||
      result.id !== row.id ||
      JSON.stringify(result.pair_keys) !==
        JSON.stringify(
          row.pool.map((p) =>
            fingerprint([
              queries[row.source][row.id],
              p.title,
              p.content || "",
            ]),
          ),
        )
    )
      throw new Error("Model candidate identity differs");
    if (
      result.scores.length !== row.pool.length ||
      result.scores.some((s) => !Number.isFinite(s))
    )
      throw new Error("Incomplete or nonfinite score vector");
  });
  return rows;
}

function compare(
  original,
  longScores,
  shortScores,
  protocol,
  queries,
  productionSelect,
  rule,
) {
  validateScoreRows(original, longScores, queries);
  validateScoreRows(original, shortScores, queries);
  let index = 0;
  return {
    sources: original.sources.map((source) => ({
      ...source,
      rows: source.rows.map((row) => {
        const long = selectVariant(
          row,
          longScores.rows[index].scores,
          {},
          protocol.constraints,
        );
        const short = selectVariant(
          row,
          shortScores.rows[index].scores,
          {},
          protocol.constraints,
        );
        // Verify real compiled selector, including its default cap3, against the
        // independent offline selector for every long and short score vector.
        const baseline = rule.rerank(queries[source.id][row.id], row.pool, {
          topK: 5,
        });
        for (const [scores, expected] of [
          [longScores.rows[index].scores, long],
          [shortScores.rows[index].scores, short],
        ]) {
          const actual = productionSelect(
            row.pool,
            baseline,
            new Map(row.pool.map((p, i) => [p.chunkId, scores[i]])),
            { topK: 5 },
          );
          if (
            JSON.stringify(actual.map((p) => p.chunkId)) !==
            JSON.stringify(expected.selected)
          )
            throw new Error(
              "Production selector differs from offline expected",
            );
          for (const item of actual) {
            const original = row.pool.find((p) => p.chunkId === item.chunkId);
            if (
              item.content !== original.content ||
              item.title !== original.title
            )
              throw new Error(
                "Production selector changed original body/title",
              );
          }
        }
        index++;
        return {
          ...row,
          options: {
            rule: row.options.rule,
            previousCap2: row.options["bge-m3-anchor2-model-order"],
            current: long,
            short,
          },
        };
      }),
    })),
  };
}

if (require.main === module) {
  const path = require("node:path");
  const { createRequire } = require("node:module");
  const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const [protocolFile, scoreFile, output] = process.argv.slice(2);
  const protocol = read(protocolFile);
  for (const [file, expected] of Object.entries(protocol.files_sha256))
    if (
      createHash("sha256").update(fs.readFileSync(file)).digest("hex") !==
      expected
    )
      throw new Error("Short-window fingerprint differs: " + file);
  const parent = read(protocol.model_protocol),
    longScores = read(protocol.long_scores),
    shortScores = read(scoreFile);
  if (
    longScores.protocol_sha256 !== fingerprint(parent) ||
    shortScores.protocol_sha256 !== fingerprint(protocol)
  )
    throw new Error("Model score protocol differs");
  if (
    JSON.stringify(shortScores.model) !== JSON.stringify(longScores.model) ||
    JSON.stringify(shortScores.model_input) !==
      JSON.stringify(protocol.short_input)
  )
    throw new Error("Model or input config differs");
  const apiRequire = createRequire(path.resolve("apps/api/package.json"));
  apiRequire("reflect-metadata");
  const { selectBge } = require(
    path.resolve("apps/api/dist/src/modules/retrieval/rerank/bge-selection.js"),
  );
  const { RerankService } = require(
    path.resolve(
      "apps/api/dist/src/modules/retrieval/rerank/rerank.service.js",
    ),
  );
  fs.writeFileSync(
    output,
    JSON.stringify(
      compare(
        read(protocol.replay),
        longScores,
        shortScores,
        protocol,
        parent.queries,
        selectBge,
        new RerankService(),
      ),
    ) + "\n",
    { flag: "wx" },
  );
}

module.exports = { validateScoreRows, compare };
