// Reproduce two independent offline diagnostics with frozen score artifacts.
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { selectDocumentFirst } = require("./rerank-document-order.cjs");
const { useLongWindow } = require("./rerank-window-cascade.cjs");

function replay(protocol) {
  for (const [file, expected] of Object.entries(protocol.files_sha256))
    if (
      createHash("sha256").update(fs.readFileSync(file)).digest("hex") !==
      expected
    )
      throw new Error("Followup fingerprint differs: " + file);
  const original = JSON.parse(fs.readFileSync(protocol.replay, "utf8"));
  let triggered = 0;
  for (const source of original.sources)
    for (const row of source.rows) {
      const short = row.options.short,
        long = row.options.current;
      const scores = new Map(short.decisions.map((d) => [d.chunkId, d.score]));
      const values = row.pool.map((p) => scores.get(p.chunkId));
      const rule = row.options.rule;
      if (protocol.aggregations) {
        const alternatives = Object.fromEntries(
          protocol.aggregations.map((a) => [
            a,
            selectDocumentFirst(row, values, a, protocol.constraints),
          ]),
        );
        row.options = { rule, current: short, ...alternatives };
      } else {
        row.cascadeTriggered = useLongWindow(values);
        triggered += Number(row.cascadeTriggered);
        row.options = {
          rule,
          current: short,
          cascade: row.cascadeTriggered ? long : short,
        };
      }
    }
  return { ...original, triggered_pools: triggered };
}

if (require.main === module) {
  const [protocol, output] = process.argv.slice(2);
  fs.writeFileSync(
    output,
    JSON.stringify(replay(JSON.parse(fs.readFileSync(protocol, "utf8")))) +
      "\n",
    { flag: "wx" },
  );
}
module.exports = { replay };
