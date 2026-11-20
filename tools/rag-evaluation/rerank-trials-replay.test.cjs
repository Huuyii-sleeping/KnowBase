const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAlternative } = require("./rerank-trials-replay.cjs");
const { fingerprint } = require("./rerank-model-replay.cjs");

test("alternative replay rejects mismatched model/input/protocol and incomplete scores", () => {
  const original = {
    sources: [
      { id: "s", rows: [{ id: "q", pool: [{ title: "t", content: "body" }] }] },
    ],
  };
  const protocol = {
    models: [{ id: "fake" }],
    runtime: {},
    model_input: { max_length: 256 },
  };
  const scores = {
    complete: true,
    model: protocol.models[0],
    runtime: {},
    model_input: protocol.model_input,
    protocol_sha256: fingerprint(protocol),
    rows: [
      {
        source: "s",
        id: "q",
        pair_keys: [fingerprint(["query", "t", "body"])],
        scores: [1],
      },
    ],
  };
  const queries = { s: { q: "query" } };
  assert.doesNotThrow(() =>
    validateAlternative(original, scores, protocol, queries),
  );
  for (const change of [
    { model: { id: "other" } },
    { model_input: { max_length: 512 } },
    { runtime: { torch: "other" } },
    { protocol_sha256: "foreign" },
    { complete: false },
    { rows: [] },
  ])
    assert.throws(() =>
      validateAlternative(
        original,
        { ...scores, ...change },
        protocol,
        queries,
      ),
    );
});
