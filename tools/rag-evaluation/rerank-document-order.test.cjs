const test = require("node:test");
const assert = require("node:assert/strict");
const { selectDocumentFirst } = require("./rerank-document-order.cjs");
const constraints = {
  topK: 5,
  maxChunksPerDocument: 3,
  maxContextCharacters: 6000,
};
const item = (id, doc) => ({ chunkId: id, documentId: doc, content: id });

test("document-first admission reserves anchors and then fills related chunks", () => {
  const row = {
    pool: [
      item("a", "a"),
      item("b", "b"),
      item("c", "c"),
      item("d", "c"),
      item("e", "c"),
      item("f", "f"),
    ],
    options: { rule: { selected: ["a", "b"] } },
  };
  const before = JSON.stringify(row);
  assert.deepEqual(
    selectDocumentFirst(row, [0, 0, 10, 1, 0.5, 9], "max", constraints)
      .selected,
    ["c", "d", "e", "a", "b"],
  );
  assert.deepEqual(
    selectDocumentFirst(row, [0, 0, 10, 1, 0.5, 9], "top2mean", constraints)
      .selected,
    ["c", "f", "d", "a", "b"],
  );
  assert.equal(JSON.stringify(row), before);
});

test("document and character constraints still limit output", () => {
  const row = {
    pool: [item("aa", "doc"), item("bb", "doc"), item("cc", "other")],
    options: { rule: { selected: [] } },
  };
  assert.deepEqual(
    selectDocumentFirst(row, [3, 2, 1], "max", {
      ...constraints,
      maxChunksPerDocument: 1,
    }).selected,
    ["aa", "cc"],
  );
  assert.deepEqual(
    selectDocumentFirst(row, [3, 2, 1], "max", {
      ...constraints,
      maxContextCharacters: 1,
    }).selected,
    ["aa"],
  );
});

test("invalid model scores, identities and aggregation fail", () => {
  const row = { pool: [item("a", "doc")], options: { rule: { selected: [] } } };
  assert.throws(() => selectDocumentFirst(row, [1], "unknown", constraints));
  assert.throws(() => selectDocumentFirst(row, [], "max", constraints));
  assert.throws(() => selectDocumentFirst(row, [NaN], "max", constraints));
  assert.throws(() =>
    selectDocumentFirst(
      { ...row, options: { rule: { selected: ["missing"] } } },
      [1],
      "max",
      constraints,
    ),
  );
});
