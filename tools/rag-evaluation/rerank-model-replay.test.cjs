const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  modelSelection,
  rrfSelection,
  fingerprint,
  replay,
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

test("full model replay rejects unfinished, foreign-protocol and wrong-candidate outputs", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "rerank-model-fixture-"),
  );
  try {
    const candidate = { ...item("c", "d"), title: "Title" };
    const original = {
      sources: [{ id: "s", rows: [{ id: "q", pool: [candidate] }] }],
    };
    await fs.writeFile(
      path.join(root, "replay.json"),
      JSON.stringify(original),
    );
    const config = { id: "model", repository: "fixture", revision: "pinned" };
    const protocol = {
      input_files_sha256: {},
      implementation_sha256: {},
      input_replay: "replay.json",
      models: [config],
      queries: { s: { q: "Query" } },
      strategies: [{ id: "model", kind: "model" }],
    };
    const row = {
      source: "s",
      id: "q",
      pair_keys: [fingerprint(["Query", "Title", "body"])],
      scores: [1],
      diagnostics: [{ windows: 1 }],
      elapsed_ms: 1,
      new_pairs: 1,
      cached_pairs: 0,
    };
    const scores = {
      protocol_sha256: fingerprint(protocol),
      model: config,
      complete: true,
      rows: [row],
    };
    const file = path.join(root, "model-scores.json");
    const save = () => fs.writeFile(file, JSON.stringify(scores));
    await save();
    assert.deepEqual(
      (await replay(root, protocol, root)).sources[0].rows[0].options.model
        .selected,
      ["c"],
    );
    scores.complete = false;
    await save();
    await assert.rejects(replay(root, protocol, root), /completeness/);
    scores.complete = true;
    scores.protocol_sha256 = "wrong";
    await save();
    await assert.rejects(replay(root, protocol, root), /fingerprint/);
    scores.protocol_sha256 = fingerprint(protocol);
    row.pair_keys = ["other-content"];
    await save();
    await assert.rejects(replay(root, protocol, root), /candidate identity/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
