const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateScoreRows } = require("./rerank-short-window.cjs");
const { fingerprint } = require("./rerank-model-replay.cjs");

test("window comparison requires every original query, candidate and finite score", () => {
  const original = {
    sources: [
      {
        id: "s",
        rows: [
          {
            id: "q",
            pool: [{ chunkId: "c", title: "标题", content: "原正文" }],
          },
        ],
      },
    ],
  };
  const queries = { s: { q: "问题" } };
  const scores = {
    complete: true,
    rows: [
      {
        source: "s",
        id: "q",
        pair_keys: [fingerprint(["问题", "标题", "原正文"])],
        scores: [-2],
      },
    ],
  };
  assert.equal(validateScoreRows(original, scores, queries).length, 1);
  for (const mutate of [
    (s) => {
      s.complete = false;
    },
    (s) => s.rows.push(s.rows[0]),
    (s) => {
      s.rows[0].pair_keys = ["different body"];
    },
    (s) => {
      s.rows[0].scores = [];
    },
    (s) => {
      s.rows[0].scores = [Infinity];
    },
  ]) {
    const changed = structuredClone(scores);
    mutate(changed);
    assert.throws(
      () => validateScoreRows(original, changed, queries),
      /Incomplete|identity|nonfinite/,
    );
  }
});
