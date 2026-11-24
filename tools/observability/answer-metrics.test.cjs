const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  parseLogLine,
  AnswerMetrics,
  distribution,
} = require('./answer-metrics.cjs');
const usage = {
  reportedInputTokens: 12,
  reportedOutputTokens: 8,
  reportedTotalTokens: 20,
  completeCalls: 1,
  unknownCalls: 0,
};
function terminal(requestId, extra = {}) {
  return {
    schemaVersion: 1,
    event: 'rag.answer.completed',
    requestId,
    status: 'success',
    latencyMs: 10,
    stages: {
      'rerank.total': { count: 1, latencyMs: 4, failures: 0, interrupted: 0 },
    },
    reranks: [{ path: 'bge', reason: 'model_selected' }],
    modelCalls: 1,
    transportRetries: 0,
    citationRepairs: 0,
    usage: { ...usage },
    ...extra,
  };
}

test('parses JSON and prefixed ANSI Nest logs; unrelated lines do not leak into output', () => {
  const event = terminal('a');
  assert.deepEqual(
    parseLogLine('\x1b[32m[Nest] LOG ' + JSON.stringify(event)),
    event,
  );
  assert.equal(parseLogLine('private debug line'), null);
  assert.equal(parseLogLine('{invalid'), null);
  assert.deepEqual(distribution([]), { count: 0, p50Ms: null, p95Ms: null });
  assert.deepEqual(distribution([100, 1, 2, 3]), {
    count: 4,
    p50Ms: 2,
    p95Ms: 100,
  });
});

test('counts service outcomes separately from quality; includes failures, unknown usage and real fallback denominator', () => {
  const metrics = new AnswerMetrics();
  for (const id of ['a', 'b', 'c', 'd', 'e'])
    metrics.add({
      schemaVersion: 1,
      requestId: id,
      event: 'rag.answer.started',
    });
  metrics.add(terminal('a'));
  metrics.add(
    terminal('b', {
      status: 'refusal',
      outcome: 'invalid-evidence',
      latencyMs: 20,
      reranks: [{ path: 'rule', reason: 'api_busy' }],
    }),
  );
  metrics.add(
    terminal('c', {
      event: 'rag.answer.failed',
      status: 'error',
      errorCode: 'MODEL_TIMEOUT',
      latencyMs: 30000,
      reranks: [{ path: 'rule', reason: 'configured_rule' }],
      usage: {
        ...usage,
        completeCalls: 0,
        unknownCalls: 1,
        reportedInputTokens: 0,
        reportedOutputTokens: 0,
        reportedTotalTokens: 0,
      },
    }),
  );
  metrics.add(
    terminal('d', {
      reranks: [{ path: 'rule', reason: 'empty_pool' }],
      modelCalls: 0,
      usage: { ...usage, completeCalls: 0 },
    }),
  );
  const result = metrics.result();
  assert.equal(result.completedRequests, 4);
  assert.equal(result.incompleteRequests, 1);
  assert.equal(result.answered, 2);
  assert.equal(result.refusals, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.serviceSuccessRate, 0.75);
  assert.equal(result.outcomes['invalid-evidence'], 1);
  assert.equal(result.rerank.fallbackRate, 0.5);
  assert.equal(result.usage.unknownCalls, 1);
  assert.equal(result.latency.p95Ms, 30000);
  assert.deepEqual(result.errors, { MODEL_TIMEOUT: 1 });
  assert.equal(result.stages['rerank.total'].count, 4);
});

test('rejects malformed terminal records, reports incomplete logs and deduplicates overlapping files', () => {
  const metrics = new AnswerMetrics();
  metrics.add(terminal('a'));
  metrics.add(terminal('a'));
  for (const extra of [
    { schemaVersion: 2 },
    { latencyMs: -1 },
    { stages: { bad: null } },
    { usage: {} },
    { status: 'anything' },
    { reranks: [{}] },
    { modelCalls: 1.5 },
  ])
    metrics.add(terminal('bad', extra));
  const result = metrics.result();
  assert.equal(result.completedRequests, 1);
  assert.equal(result.duplicateTerminals, 1);
  assert.equal(result.invalidEvents, 7);
  assert.equal(result.terminalsWithoutStart, 1);
  assert.equal(new AnswerMetrics().result().serviceSuccessRate, null);
});

test('CLI consumes stdin, prints only aggregate fields and returns nonzero for bad paths or arguments', () => {
  const cli = path.join(__dirname, 'summarize-answers.cjs');
  const processResult = spawnSync(process.execPath, [cli], {
    input: 'secret-key debug\n' + JSON.stringify(terminal('a')) + '\n',
    encoding: 'utf8',
  });
  assert.equal(processResult.status, 0);
  assert.equal(JSON.parse(processResult.stdout).completedRequests, 1);
  assert.ok(!processResult.stdout.includes('secret-key'));
  for (const args of [['--bad'], [path.join(__dirname, 'missing-file')]]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /summary failed/);
  }
});
