const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fuseRanks, replayFusion } = require("./rerank-fusion.cjs");

function fixture() {
  return {
    pool: ["a", "b", "c"].map((chunkId) => ({
      chunkId,
      documentId: "d",
      content: "原正文",
      title: "标题",
    })),
    options: {
      rule: {
        selected: ["a", "b"],
        decisions: [
          { chunkId: "a", score: 100 },
          { chunkId: "b", score: 10 },
          { chunkId: "c", score: 1 },
        ],
      },
      "bge-m3": {
        decisions: [
          { chunkId: "a", score: -10 },
          { chunkId: "b", score: 2 },
          { chunkId: "c", score: 2 },
        ],
      },
      "bge-m3-anchor2-model-order": { selected: ["b", "a"] },
    },
  };
}

test("equal-weight RRF uses full ranks, stable ties, never logit magnitude", () => {
  const row = fixture(),
    original = structuredClone(row);
  assert.deepEqual(fuseRanks(row), [
    1 / 61 + 1 / 63,
    1 / 62 + 1 / 61,
    1 / 63 + 1 / 62,
  ]);
  row.options["bge-m3"].decisions.forEach((d) => {
    d.score = 1000 * d.score + 900;
  });
  assert.deepEqual(fuseRanks(row), fuseRanks(original));
  assert.deepEqual(original, fixture());
});

test("fusion preserves two anchors, full bodies, caps and source baseline", () => {
  const input = { sources: [{ id: "s", rows: [fixture()] }] },
    before = structuredClone(input);
  const result = replayFusion(input, {
    constant: 60,
    constraints: { topK: 3, maxChunksPerDocument: 2 },
  });
  assert.deepEqual(result.sources[0].rows[0].options.fused.selected, [
    "b",
    "a",
  ]);
  assert.equal(
    result.sources[0].rows[0].options.fused.decisions.find(
      (d) => d.chunkId === "c",
    ).reason,
    "document_cap",
  );
  assert.deepEqual(input, before);
});

test("partial, duplicated, foreign and nonfinite ranks fail instead of fusing", () => {
  for (const mutate of [
    (r) => r.options.rule.decisions.pop(),
    (r) => {
      r.options.rule.decisions[1].chunkId = "a";
    },
    (r) => {
      r.options.rule.decisions[1].chunkId = "foreign";
    },
    (r) => {
      r.options["bge-m3"].decisions[0].score = NaN;
    },
  ]) {
    const row = fixture();
    mutate(row);
    assert.throws(() => fuseRanks(row), /Incomplete or nonfinite/);
  }
  assert.throws(() => fuseRanks(fixture(), 0), /positive integer/);
});
