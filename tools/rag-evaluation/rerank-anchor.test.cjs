const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reserveRuleAnchors } = require("./rerank-anchor.cjs");

const row = () => ({
  pool: [
    { chunkId: "a", documentId: "d1", content: "aa" },
    { chunkId: "b", documentId: "d2", content: "bb" },
    { chunkId: "c", documentId: "d1", content: "cc" },
    { chunkId: "d", documentId: "d1", content: "dd" },
    { chunkId: "e", documentId: "d3", content: "ee" },
  ],
  options: { rule: { selected: ["a", "b", "e"] } },
});

test("anchors preserve baseline order before model fill, deduplication and shared constraints", () => {
  const input = row();
  const before = structuredClone(input);
  const result = reserveRuleAnchors(
    input,
    { scores: [-9, -8, 10, 9, 8] },
    {
      anchorCount: 2,
      topK: 4,
      maxChunksPerDocument: 2,
      maxContextCharacters: 8,
    },
  );
  assert.deepEqual(result.selected, ["a", "b", "c", "e"]);
  assert.deepEqual(result.anchors, ["a", "b"]);
  assert.equal(
    result.decisions.find((d) => d.chunkId === "d").reason,
    "document_cap",
  );
  assert.equal(result.decisions[0].ruleAnchor, true);
  assert.deepEqual(input, before);
});

test("empty and short baselines fill normally; invalid inputs stop and first oversized behavior is preserved", () => {
  const input = row();
  input.options.rule.selected = [];
  assert.deepEqual(
    reserveRuleAnchors(input, { scores: [1, 2, 3, 4, 5] }, { topK: 2 })
      .selected,
    ["e", "d"],
  );
  input.options.rule.selected = ["a"];
  input.pool[0].content = "123456";
  assert.deepEqual(
    reserveRuleAnchors(
      input,
      { scores: [1, 2, 3, 4, 5] },
      { maxContextCharacters: 2 },
    ).selected,
    ["a"],
  );
  for (const anchorCount of [-1, 6, 1.5])
    assert.throws(
      () =>
        reserveRuleAnchors(input, { scores: [1, 2, 3, 4, 5] }, { anchorCount }),
      /Invalid anchor/,
    );
  assert.throws(
    () => reserveRuleAnchors(input, { scores: [NaN, 2, 3, 4, 5] }),
    /nonfinite/,
  );
  assert.throws(() => reserveRuleAnchors(input, { scores: [1] }), /Incomplete/);
  input.options.rule.selected = ["outside"];
  assert.throws(
    () => reserveRuleAnchors(input, { scores: [1, 2, 3, 4, 5] }),
    /Invalid baseline/,
  );
});
