// Separate experiment: reuse verified model scores without another inference run.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { replay, fingerprint } = require("./rerank-model-replay.cjs");
const { reserveRuleAnchors } = require("./rerank-anchor.cjs");

function addAnchors(original, protocol) {
  const sources = original.sources.map((source) => ({
    ...source,
    rows: source.rows.map((row) => {
      const options = {};
      for (const strategy of protocol.strategies) {
        if (strategy.kind !== "anchor") {
          if (!row.options[strategy.id])
            throw new Error("Missing parent strategy");
          options[strategy.id] = row.options[strategy.id];
          continue;
        }
        const parent = row.options[strategy.model];
        if (!parent) throw new Error("Missing parent model");
        const scores = new Map(
          parent.decisions.map((d) => [d.chunkId, d.score]),
        );
        const started = performance.now();
        options[strategy.id] = {
          ...reserveRuleAnchors(
            row,
            { scores: row.pool.map((item) => scores.get(item.chunkId)) },
            {
              ...protocol.fixed_constraints,
              anchorCount: strategy.anchorCount,
            },
          ),
          elapsedMs: performance.now() - started,
          inferenceMs: parent.inferenceMs,
        };
      }
      return { ...row, options };
    }),
  }));
  return { protocol_sha256: fingerprint(protocol), sources };
}

async function anchorReplay(root, protocol, scoreDirectory) {
  for (const [file, expected] of Object.entries(protocol.files_sha256)) {
    const bytes = await fs.readFile(path.resolve(root, file));
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      throw new Error("Anchor experiment fingerprint differs: " + file);
  }
  const parent = JSON.parse(
    await fs.readFile(path.resolve(root, protocol.parent_protocol), "utf8"),
  );
  const original = await replay(root, parent, scoreDirectory);
  if (
    JSON.stringify(parent.sources) !== JSON.stringify(protocol.sources) ||
    JSON.stringify(parent.fixed_constraints) !==
      JSON.stringify(protocol.fixed_constraints)
  )
    throw new Error("Anchor experiment changes parent sources or constraints");
  return addAnchors(original, protocol);
}

if (require.main === module) {
  (async () => {
    const [protocolFile, scoreDirectory, output] = process.argv.slice(2);
    if (!protocolFile || !scoreDirectory || !output)
      throw new Error("usage: protocol score-directory output");
    const protocol = JSON.parse(await fs.readFile(protocolFile, "utf8"));
    const result = await anchorReplay(
      path.resolve(__dirname, "../.."),
      protocol,
      scoreDirectory,
    );
    await fs.writeFile(output, JSON.stringify(result) + "\n", { flag: "wx" });
    console.log(
      JSON.stringify({
        rows: result.sources.reduce((n, s) => n + s.rows.length, 0),
      }),
    );
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { addAnchors, anchorReplay };
