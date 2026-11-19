// Offline rule + cross-encoder rank fusion. No questions or gold labels.
const { selectVariant } = require("./rerank-refinement.cjs");

function fuseRanks(row, constant = 60) {
  if (!Number.isInteger(constant) || constant < 1)
    throw new Error("RRF constant must be a positive integer");
  const ids = row.pool.map((p) => p.chunkId);
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate pool identities");
  const decisions = ["rule", "bge-m3"].map((name) => {
    const list = row.options[name].decisions;
    if (
      list.length !== ids.length ||
      new Set(list.map((d) => d.chunkId)).size !== ids.length ||
      list.some((d) => !ids.includes(d.chunkId) || !Number.isFinite(d.score))
    )
      throw new Error("Incomplete or nonfinite rank input");
    return new Map(list.map((d) => [d.chunkId, d]));
  });
  const ranks = decisions.map(
    (byId) =>
      new Map(
        [...row.pool]
          .sort((a, b) => byId.get(b.chunkId).score - byId.get(a.chunkId).score)
          .map((p, i) => [p.chunkId, i + 1]),
      ),
  );
  return ids.map((id) =>
    ranks.reduce((sum, rank) => sum + 1 / (constant + rank.get(id)), 0),
  );
}

function replayFusion(original, protocol) {
  return {
    sources: original.sources.map((source) => ({
      ...source,
      rows: source.rows.map((row) => ({
        ...row,
        options: {
          rule: row.options.rule,
          current: row.options["bge-m3-anchor2-model-order"],
          fused: selectVariant(
            row,
            fuseRanks(row, protocol.constant),
            {},
            protocol.constraints,
          ),
        },
      })),
    })),
  };
}

if (require.main === module) {
  const fs = require("node:fs");
  const { createHash } = require("node:crypto");
  const [protocolFile, output] = process.argv.slice(2);
  const protocol = JSON.parse(fs.readFileSync(protocolFile, "utf8"));
  for (const [file, expected] of Object.entries(protocol.files_sha256))
    if (
      createHash("sha256").update(fs.readFileSync(file)).digest("hex") !==
      expected
    )
      throw new Error("Fusion input fingerprint differs: " + file);
  const original = JSON.parse(fs.readFileSync(protocol.replay, "utf8"));
  fs.writeFileSync(
    output,
    JSON.stringify(replayFusion(original, protocol)) + "\n",
    { flag: "wx" },
  );
}

module.exports = { fuseRanks, replayFusion };
