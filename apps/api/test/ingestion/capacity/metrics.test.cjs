const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  distribution,
  fixture,
  boundedMap,
  stageMetrics,
} = require('./metrics.cjs');
const { CapacityMonitor } = require('./monitor.cjs');
test('nearest-rank quantiles preserve count, reject invalid, and represent no data as null', () => {
  assert.deepEqual(distribution([]), {
    count: 0,
    p50: null,
    p95: null,
    max: null,
  });
  assert.deepEqual(distribution(Array.from({ length: 20 }, (_, i) => 20 - i)), {
    count: 20,
    p50: 10,
    p95: 19,
    max: 20,
  });
  assert.throws(() => distribution([NaN]));
  assert.throws(() => distribution([-1]));
});
test('fixed-byte inputs have stable hash, unique content and intact facts at both ends', () => {
  for (const bytes of [16384, 65536]) {
    const f = fixture(bytes, 7);
    assert.equal(f.data.length, bytes);
    assert.equal(f.sha256, fixture(bytes, 7).sha256);
    assert.notEqual(f.sha256, fixture(bytes, 8).sha256);
    assert.ok(f.data.toString().startsWith(f.fact));
    assert.ok(f.data.toString().endsWith(f.fact));
  }
  assert.throws(() => fixture(1, 0));
  assert.throws(() => fixture(1024, -1));
});
test('bounded runner limits concurrency, orders results and waits for in-flight work on failure', async () => {
  let active = 0,
    peak = 0,
    finished = 0;
  const values = await boundedMap([1, 2, 3, 4], 2, async (v) => {
    active++;
    peak = Math.max(active, peak);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return v * 2;
  });
  assert.deepEqual(values, [2, 4, 6, 8]);
  assert.equal(peak, 2);
  await assert.rejects(
    () =>
      boundedMap([0, 1, 2], 2, async (v) => {
        if (v === 0) throw Error('injected');
        await new Promise((r) => setTimeout(r, 10));
        finished++;
      }),
    /injected/,
  );
  assert.equal(finished, 1);
  await assert.rejects(() => boundedMap([], 0, () => {}));
});
test('stage aggregation excludes other document IDs, malformed lines and cache counts', () => {
  const lines = [
    'noise',
    'prefix ' +
      JSON.stringify({
        documentId: 'a',
        stage: 'parse',
        status: 'completed',
        durationMs: 10,
      }),
    JSON.stringify({
      documentId: 'b',
      stage: 'parse',
      status: 'completed',
      durationMs: 99,
    }),
    JSON.stringify({ documentId: 'a', stage: 'embedding.cache', inputs: 2 }),
  ].join('\n');
  assert.deepEqual(stageMetrics(lines, new Set(['a'])), {
    'parse:shared:completed': { count: 1, p50: 10, p95: 10, max: 10 },
  });
});
test('missing telemetry remains unknown; monitor records failures instead of zeros', async () => {
  const monitor = new CapacityMonitor(
    {
      sample: async () => {
        throw Error('gone');
      },
      source: {
        query: async () => {
          throw Error('gone');
        },
      },
    },
    'http://127.0.0.1:1',
  );
  await monitor.sample();
  const result = monitor.summary();
  assert.equal(result.errors.length, 4);
  assert.equal(result.rssBytes.max, null);
  assert.equal(result.rabbitReady.max, null);
  assert.equal(result.applicationCpuMs, null);
});
