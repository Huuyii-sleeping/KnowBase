// Isolated real-HTTP checks of current BGE defaults and overload fallback.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = async (f) => JSON.parse(await fs.readFile(f, "utf8"));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function check(protocol, endpoint) {
  for (const [file, expected] of Object.entries(protocol.files_sha256))
    assert.equal(hash(await fs.readFile(file)), expected, file);
  const apiRequire = createRequire(path.resolve("apps/api/package.json"));
  apiRequire("reflect-metadata");
  const { ConfigService } = apiRequire("@nestjs/config");
  const modules = path.resolve("apps/api/dist/src/modules/retrieval/rerank");
  const { BgeHttpService } = require(path.join(modules, "bge-http.service.js"));
  const { HybridRerankService } = require(
    path.join(modules, "hybrid-rerank.service.js"),
  );
  const { RerankService } = require(path.join(modules, "rerank.service.js"));
  const replay = await read(protocol.replay),
    parent = await read(protocol.query_protocol);
  const scores = await read(protocol.scores);
  const cases = replay.sources.flatMap((source) =>
    source.rows.map((row) => ({ source, row })),
  );
  const createService = (timeout = 20000, cooldown = 100) => {
    const provider = new BgeHttpService(
      new ConfigService({
        RAG_RERANKER: "bge",
        BGE_RERANK_URL: endpoint,
        BGE_RERANK_TIMEOUT_MS: timeout,
        BGE_RERANK_COOLDOWN_MS: cooldown,
      }),
    );
    return new HybridRerankService(new RerankService(), provider);
  };
  const isModel = (items) =>
    items.length > 0 && items.every((p) => Number.isFinite(p.rerankModelScore));
  const rows = [],
    service = createService();
  for (const c of protocol.cases) {
    const index = cases.findIndex(
      ({ source, row }) => source.id === c.source && row.id === c.id,
    );
    assert.ok(index >= 0);
    const { source, row } = cases[index];
    const query = parent.queries[source.id][row.id];
    const started = performance.now();
    const actual = await service.rerank(query, row.pool, { topK: 5 });
    assert.ok(isModel(actual), "Serial model request unexpectedly fell back");
    assert.deepEqual(
      actual.map((p) => p.chunkId),
      row.options.short.selected,
    );
    const scoreMap = new Map(
      row.pool.map((p, i) => [p.chunkId, scores.rows[index].scores[i]]),
    );
    for (const item of actual) {
      const original = row.pool.find((p) => p.chunkId === item.chunkId);
      assert.equal(item.content, original.content);
      assert.equal(item.title, original.title);
      assert.equal(item.rerankModelScore, scoreMap.get(item.chunkId));
    }
    rows.push({
      ...c,
      elapsed_ms: performance.now() - started,
      selected: actual.map((p) => p.chunkId),
      fallback: false,
    });
    process.stdout.write(
      JSON.stringify({
        serial_completed: rows.length,
        total: protocol.cases.length,
      }) + "\n",
    );
  }
  const { source, row } = cases.find(
    ({ source, row }) =>
      source.id === protocol.cases[0].source && row.id === protocol.cases[0].id,
  );
  const query = parent.queries[source.id][row.id];
  const baseline = new RerankService().rerank(query, row.pool, { topK: 5 });
  const assertFallback = (items) => assert.deepEqual(items, baseline);
  const shared = createService();
  const sameInstance = await Promise.all(
    Array.from({ length: 6 }, () =>
      shared.rerank(query, row.pool, { topK: 5 }),
    ),
  );
  assert.equal(sameInstance.filter(isModel).length, 1);
  sameInstance.filter((items) => !isModel(items)).forEach(assertFallback);
  const acrossInstances = await Promise.all(
    Array.from({ length: 4 }, () =>
      createService().rerank(query, row.pool, { topK: 5 }),
    ),
  );
  assert.equal(acrossInstances.filter(isModel).length, 1);
  acrossInstances.filter((items) => !isModel(items)).forEach(assertFallback);

  const timed = createService(200);
  const started = performance.now();
  assertFallback(await timed.rerank(query, row.pool, { topK: 5 }));
  const timeoutMs = performance.now() - started;
  // Wait for the uncancellable inference to release its lock, with bounded probes.
  const probe = new BgeHttpService(
    new ConfigService({ RAG_RERANKER: "bge", BGE_RERANK_URL: endpoint }),
  );
  let ready = false,
    busyProbes = 0;
  for (let attempts = 0; attempts < 60; attempts++) {
    await pause(500);
    try {
      await probe.score("颜色是什么？", [
        { chunkId: "health", title: "颜色", content: "颜色是蓝色。" },
      ]);
      ready = true;
      break;
    } catch {
      busyProbes++;
    }
  }
  assert.ok(ready, "Runtime did not recover after timed out inference");
  const recovered = await createService().rerank(query, row.pool, { topK: 5 });
  assert.ok(isModel(recovered));
  assert.deepEqual(
    recovered.map((p) => p.chunkId),
    row.options.short.selected,
  );
  return {
    complete: true,
    rows,
    same_instance: { concurrent: 6, model: 1, fallback: 5 },
    across_instances: { concurrent: 4, model: 1, fallback: 3 },
    timeout: {
      deadline_ms: 200,
      observed_ms: timeoutMs,
      busy_probes: busyProbes,
      recovered: true,
    },
    scope:
      "Local real model HTTP through production API adapter. Frozen synthetic candidate pools, no database/recall/answer calls; overload fallback is not increased model throughput.",
  };
}

if (require.main === module) {
  const [protocolFile, endpoint, output] = process.argv.slice(2);
  read(protocolFile)
    .then((p) => check(p, endpoint))
    .then((result) =>
      fs.writeFile(output, JSON.stringify(result, null, 2) + "\n", {
        flag: "wx",
      }),
    )
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
module.exports = { check };
