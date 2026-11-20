const test = require("node:test");
const assert = require("node:assert/strict");
const { isDuplicate, selectTrial } = require("./rerank-selection-trials.cjs");
const constraints = {
  topK: 5,
  maxChunksPerDocument: 3,
  maxContextCharacters: 6000,
};
const item = (id, content, doc = id) => ({
  chunkId: id,
  documentId: doc,
  content,
  title: id,
});

test("duplicate suppression frees a slot and keeps source inputs unchanged", () => {
  const body = "Maintenance requires a signed record and approval.";
  const row = {
    pool: [item("a", body), item("b", body), item("c", "Other evidence")],
    options: { rule: { selected: ["a", "b"] } },
  };
  const before = JSON.stringify(row);
  const result = selectTrial(
    row,
    [3, 2, 1],
    { kind: "dedup", similarity: 0.9 },
    constraints,
  );
  assert.deepEqual(result.selected, ["a", "c"]);
  assert.equal(
    result.decisions.find((d) => d.chunkId === "b").reason,
    "near_duplicate",
  );
  assert.equal(JSON.stringify(row), before);
});

test("numbers, negation, version identifiers and empty bodies are not collapsed", () => {
  for (const [a, b] of [
    ["额度 500 元", "额度 800 元"],
    ["可以批准", "不可以批准"],
    ["POL-24 适用", "POL-25 适用"],
    ["当前现行制度", "当前历史制度"],
    ["", ""],
  ])
    assert.equal(isDuplicate(item("a", a), item("b", b), 0.1), false);
});

test("weak-score filter applies to anchors and can return an empty result", () => {
  const row = {
    pool: [item("a", "one"), item("b", "two")],
    options: { rule: { selected: ["a"] } },
  };
  assert.deepEqual(
    selectTrial(row, [-2, -1], { kind: "threshold", minScore: 0 }, constraints)
      .selected,
    [],
  );
  assert.deepEqual(
    selectTrial(row, [-2, 0], { kind: "threshold", minScore: 0 }, constraints)
      .selected,
    ["b"],
  );
});

test("constraints, stable ties and full original-body budget still apply", () => {
  const row = {
    pool: [
      item("a", "first", "doc"),
      item("b", "second", "doc"),
      item("c", "third"),
    ],
    options: { rule: { selected: ["a", "b"] } },
  };
  assert.deepEqual(
    selectTrial(
      row,
      [1, 1, 1],
      { kind: "threshold", minScore: 0 },
      { ...constraints, maxChunksPerDocument: 1 },
    ).selected,
    ["a", "c"],
  );
  assert.deepEqual(
    selectTrial(
      row,
      [1, 1, 1],
      { kind: "dedup", similarity: 0.9 },
      { ...constraints, maxContextCharacters: 1 },
    ).selected,
    ["a"],
  );
});

test("invalid scores, policies and identities fail before producing selections", () => {
  const row = {
    pool: [item("a", "text")],
    options: { rule: { selected: ["a"] } },
  };
  for (const scores of [[], [NaN], [Infinity]])
    assert.throws(() =>
      selectTrial(row, scores, { kind: "control" }, constraints),
    );
  for (const variant of [
    { kind: "missing" },
    { kind: "dedup", similarity: 2 },
    { kind: "threshold", minScore: NaN },
  ])
    assert.throws(() => selectTrial(row, [1], variant, constraints));
  assert.throws(() =>
    selectTrial(
      { ...row, pool: [row.pool[0], row.pool[0]] },
      [1, 2],
      { kind: "dedup", similarity: 0.9 },
      constraints,
    ),
  );
  assert.throws(() =>
    selectTrial(
      { ...row, options: { rule: { selected: ["foreign"] } } },
      [1],
      { kind: "dedup", similarity: 0.9 },
      constraints,
    ),
  );
});
