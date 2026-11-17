const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  modelSelection,
  rrfSelection,
  fingerprint,
} = require("./rerank-model-replay.cjs");

const item = (chunkId, documentId, content = "body") => ({
  chunkId,
  documentId,
  content,
});

test("model scores select original complete bodies with stable ties and shared caps", () => {
  const row = {
    pool: [item("a", "d"), item("b", "d"), item("c", "d"), item("e", "e")],
  };
  const original = structuredClone(row);
  const scores = {
    scores: [4, 3, 3, 2],
    elapsed_ms: 12,
    new_pairs: 4,
    cached_pairs: 0,
    diagnostics: Array.from({ length: 4 }, () => ({ windows: 2 })),
  };
  const result = modelSelection(row, scores, { topK: 3 });
  assert.deepEqual(result.selected, ["a", "b", "e"]);
  assert.equal(result.decisions[2].reason, "document_cap");
  assert.equal(result.inferenceMs, 12);
  assert.equal(result.windows, 8);
  assert.deepEqual(row, original);
  assert.throws(
    () => modelSelection(row, { ...scores, scores: [1] }, {}),
    /Incomplete/,
  );
  assert.throws(
    () => modelSelection(row, { ...scores, scores: [1, 2, 3, NaN] }, {}),
    /nonfinite/,
  );
});

test("RRF cap diagnostic reuses exact ranks and does not change score or TopK", () => {
  const row = {
    pool: [item("a", "d"), item("b", "d"), item("c", "d"), item("e", "e")],
    options: {
      rrf: {
        decisions: [
          { chunkId: "a", rank: 3, score: 0.02 },
          { chunkId: "b", rank: 1, score: 0.04 },
          { chunkId: "c", rank: 2, score: 0.03 },
          { chunkId: "e", rank: 4, score: 0.01 },
        ],
      },
    },
  };
  assert.deepEqual(
    rrfSelection(row, { maxChunksPerDocument: 5, topK: 3 }).selected,
    ["b", "c", "a"],
  );
  assert.deepEqual(
    rrfSelection(row, { maxChunksPerDocument: 2, topK: 3 }).selected,
    ["b", "c", "e"],
  );
  assert.equal(fingerprint(["问题", "正文"]).length, 64);
});
