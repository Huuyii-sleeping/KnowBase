// Validate fixed artifacts and replay selection policies; no quality labels.
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { fingerprint } = require("./rerank-model-replay.cjs");
const { validateScoreRows } = require("./rerank-short-window.cjs");
const { selectTrial } = require("./rerank-selection-trials.cjs");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function validateAlternative(original, scores, protocol, queries) {
  const model = protocol.models.find((m) => m.id === scores.model?.id);
  if (
    !model ||
    JSON.stringify(model) !== JSON.stringify(scores.model) ||
    scores.protocol_sha256 !== fingerprint(protocol) ||
    JSON.stringify(scores.model_input) !==
      JSON.stringify(protocol.model_input) ||
    JSON.stringify(scores.runtime) !== JSON.stringify(protocol.runtime)
  )
    throw new Error("Foreign model, input, runtime or protocol");
  validateScoreRows(original, scores, queries);
}

function replay(protocol, alternatives = []) {
  for (const [file, expected] of Object.entries(protocol.files_sha256)) {
    if (
      createHash("sha256").update(fs.readFileSync(file)).digest("hex") !==
      expected
    )
      throw new Error("Trial fingerprint differs: " + file);
  }
  const parent = read(protocol.model_protocol);
  const original = read(protocol.replay),
    current = read(protocol.current_scores);
  const frozen = read(protocol.current_replay);
  validateScoreRows(original, current, parent.queries);
  if (
    JSON.stringify(current.model_input) !== JSON.stringify(protocol.model_input)
  )
    throw new Error("Current input differs");
  const modelIds = alternatives.map((s) => s.model.id);
  if (new Set(modelIds).size !== modelIds.length)
    throw new Error("Duplicate alternative model");
  for (const scores of alternatives)
    validateAlternative(original, scores, protocol, parent.queries);
  let index = 0;
  return {
    sources: original.sources.map((source, sourceIndex) => ({
      ...source,
      rows: source.rows.map((row, rowIndex) => {
        const options = { rule: row.options.rule };
        for (const variant of protocol.variants)
          options[variant.id] = selectTrial(
            row,
            current.rows[index].scores,
            variant,
            protocol.constraints,
          );
        const expected = frozen.sources[sourceIndex].rows[rowIndex];
        if (
          expected.id !== row.id ||
          JSON.stringify(expected.options.short.selected) !==
            JSON.stringify(options.current.selected)
        )
          throw new Error("Control differs from adopted production replay");
        for (const model of alternatives)
          options[model.model.id] = selectTrial(
            row,
            model.rows[index].scores,
            { kind: "model" },
            protocol.constraints,
          );
        index++;
        return { ...row, options };
      }),
    })),
  };
}

if (require.main === module) {
  const [protocolFile, output, ...scoreFiles] = process.argv.slice(2);
  fs.writeFileSync(
    output,
    JSON.stringify(replay(read(protocolFile), scoreFiles.map(read))) + "\n",
    { flag: "wx" },
  );
}

module.exports = { validateAlternative, replay };
