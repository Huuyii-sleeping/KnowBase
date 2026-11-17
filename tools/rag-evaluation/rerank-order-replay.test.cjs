const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  orderSelected,
  addModelOrder,
  orderReplay,
} = require("./rerank-order-replay.cjs");

test("model ordering preserves admitted membership, caps, diagnostics and stable ties", () => {
  const selection = {
    selected: ["a", "b", "c"],
    characters: 6001,
    anchors: ["a", "b"],
    decisions: [{ reason: "selected" }],
    elapsedMs: 2,
  };
  const model = {
    decisions: [
      { chunkId: "outside", score: 99 },
      { chunkId: "a", score: 1 },
      { chunkId: "b", score: 5 },
      { chunkId: "c", score: 5 },
    ],
  };
  const original = structuredClone(selection);
  const result = orderSelected(selection, model);
  assert.deepEqual(result.selected, ["b", "c", "a"]);
  assert.deepEqual(result.admissionSelected, original.selected);
  assert.equal(result.characters, selection.characters);
  assert.deepEqual(result.anchors, selection.anchors);
  assert.deepEqual(result.decisions, selection.decisions);
  assert.deepEqual(selection, original);
  assert.deepEqual(
    orderSelected({ ...selection, selected: [] }, model).selected,
    [],
  );
  assert.deepEqual(
    orderSelected({ ...selection, selected: ["a"] }, model).selected,
    ["a"],
  );
  assert.throws(
    () => orderSelected({ ...selection, selected: ["a", "a"] }, model),
    /Invalid/,
  );
  assert.throws(
    () =>
      orderSelected(selection, { decisions: [{ chunkId: "a", score: NaN }] }),
    /incomplete/,
  );
  assert.throws(
    () =>
      orderSelected(selection, {
        decisions: [...model.decisions, model.decisions[0]],
      }),
    /Invalid/,
  );
});

test("adapter retains baseline/source identity and rejects absent options and changed frozen files", async () => {
  const baseline = { selected: ["a"], elapsedMs: 1 };
  const input = {
    sources: [
      {
        id: "s",
        metadata: { frozen: true },
        rows: [
          {
            id: "q",
            options: {
              rule: baseline,
              anchor: baseline,
              model: { decisions: [{ chunkId: "a", score: 1 }] },
            },
          },
        ],
      },
    ],
  };
  const protocol = {
    strategies: [
      { id: "rule" },
      {
        id: "ordered",
        kind: "model-order",
        admission: "anchor",
        model: "model",
      },
    ],
  };
  const result = addModelOrder(input, protocol);
  assert.deepEqual(result.sources[0].metadata, input.sources[0].metadata);
  assert.deepEqual(result.sources[0].rows[0].options.rule, baseline);
  assert.deepEqual(result.sources[0].rows[0].options.ordered.selected, ["a"]);
  const bad = structuredClone(input);
  delete bad.sources[0].rows[0].options.model;
  assert.throws(() => addModelOrder(bad, protocol), /Missing model/);
  delete bad.sources[0].rows[0].options.anchor;
  assert.throws(() => addModelOrder(bad, protocol), /Missing admission/);
  await assert.rejects(
    orderReplay(
      __dirname,
      { files_sha256: { "rerank-order-replay.cjs": "changed" } },
      "/missing",
    ),
    /fingerprint/,
  );
});
