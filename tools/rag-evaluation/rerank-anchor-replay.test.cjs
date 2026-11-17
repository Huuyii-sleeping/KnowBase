const { test } = require("node:test");
const assert = require("node:assert/strict");
const { addAnchors, anchorReplay } = require("./rerank-anchor-replay.cjs");

test("adapter preserves source and baseline and joins model decisions by chunk identity", () => {
  const row = {
    id: "q",
    pool: ["a", "b", "c"].map((chunkId) => ({
      chunkId,
      documentId: chunkId,
      content: "x",
    })),
    options: {
      rule: { selected: ["a", "b"] },
      model: {
        decisions: [
          { chunkId: "c", score: 10 },
          { chunkId: "b", score: 2 },
          { chunkId: "a", score: 1 },
        ],
        inferenceMs: 123,
      },
    },
  };
  const input = {
    sources: [{ id: "source", metadata: { frozen: true }, rows: [row] }],
  };
  const before = structuredClone(input);
  const protocol = {
    fixed_constraints: { topK: 2 },
    strategies: [
      { id: "rule" },
      { id: "model" },
      { id: "anchor", kind: "anchor", model: "model", anchorCount: 1 },
    ],
  };
  const result = addAnchors(input, protocol);
  assert.deepEqual(result.sources[0].rows[0].options.anchor.selected, [
    "a",
    "c",
  ]);
  assert.equal(result.sources[0].rows[0].options.anchor.inferenceMs, 123);
  assert.deepEqual(result.sources[0].rows[0].options.rule, row.options.rule);
  assert.deepEqual(result.sources[0].metadata, { frozen: true });
  assert.deepEqual(input, before);
  const missing = structuredClone(input);
  missing.sources[0].rows[0].options.model.decisions.pop();
  assert.throws(() => addAnchors(missing, protocol), /nonfinite/);
  delete missing.sources[0].rows[0].options.model;
  assert.throws(() => addAnchors(missing, protocol), /Missing parent/);
});

test("adapter rejects changed frozen files before reading scores", async () => {
  await assert.rejects(
    anchorReplay(
      __dirname,
      { files_sha256: { "rerank-anchor.cjs": "wrong" } },
      "/missing",
    ),
    /fingerprint differs/,
  );
});
