// Separate admission from presentation order; never retrieve or replace a chunk.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { fingerprint } = require("./rerank-model-replay.cjs");
const { anchorReplay } = require("./rerank-anchor-replay.cjs");

function orderSelected(selection, model) {
  const started = performance.now();
  const scores = new Map(model.decisions.map((d) => [d.chunkId, d.score]));
  if (
    scores.size !== model.decisions.length ||
    new Set(selection.selected).size !== selection.selected.length ||
    selection.selected.some((id) => !Number.isFinite(scores.get(id)))
  )
    throw new Error("Invalid selection or incomplete model scores");
  const selected = [...selection.selected].sort(
    (a, b) => scores.get(b) - scores.get(a),
  );
  const orderingMs = performance.now() - started;
  return {
    ...selection,
    selected,
    admissionSelected: [...selection.selected],
    decisionsDescribe:
      "admission before final model order; selected lists final order",
    orderingMs,
    elapsedMs: selection.elapsedMs + orderingMs,
  };
}

function addModelOrder(original, protocol) {
  return {
    protocol_sha256: fingerprint(protocol),
    sources: original.sources.map((source) => ({
      ...source,
      rows: source.rows.map((row) => ({
        ...row,
        options: Object.fromEntries(
          protocol.strategies.map((strategy) => {
            const admission = row.options[strategy.admission || strategy.id];
            if (!admission) throw new Error("Missing admission strategy");
            if (strategy.kind !== "model-order")
              return [strategy.id, admission];
            const model = row.options[strategy.model];
            if (!model) throw new Error("Missing model strategy");
            return [strategy.id, orderSelected(admission, model)];
          }),
        ),
      })),
    })),
  };
}

async function orderReplay(root, protocol, scoreDirectory) {
  for (const [file, expected] of Object.entries(protocol.files_sha256)) {
    if (
      createHash("sha256")
        .update(await fs.readFile(path.resolve(root, file)))
        .digest("hex") !== expected
    )
      throw new Error("Order experiment fingerprint differs: " + file);
  }
  const parent = JSON.parse(
    await fs.readFile(path.resolve(root, protocol.parent_protocol), "utf8"),
  );
  if (
    JSON.stringify(parent.sources) !== JSON.stringify(protocol.sources) ||
    JSON.stringify(parent.fixed_constraints) !==
      JSON.stringify(protocol.fixed_constraints)
  )
    throw new Error("Order experiment changes parent sources or constraints");
  return addModelOrder(
    await anchorReplay(root, parent, scoreDirectory),
    protocol,
  );
}

if (require.main === module) {
  (async () => {
    const [protocolFile, scoreDirectory, output] = process.argv.slice(2);
    if (!protocolFile || !scoreDirectory || !output)
      throw new Error("usage: protocol score-directory output");
    const protocol = JSON.parse(await fs.readFile(protocolFile, "utf8"));
    const result = await orderReplay(
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

module.exports = { orderSelected, addModelOrder, orderReplay };
