const terminalNames = new Set(['rag.answer.completed', 'rag.answer.failed']);
const nonnegative = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value) => nonnegative(value) && Number.isSafeInteger(value);
const usageKeys = [
  'reportedInputTokens',
  'reportedOutputTokens',
  'reportedTotalTokens',
  'completeCalls',
  'unknownCalls',
];

function parseLogLine(line) {
  const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
  const start = plain.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(plain.slice(start));
  } catch {
    return null;
  }
}

function validTerminal(event) {
  return (
    terminalNames.has(event.event) &&
    ['success', 'refusal', 'error'].includes(event.status) &&
    (event.event === 'rag.answer.failed') === (event.status === 'error') &&
    nonnegative(event.latencyMs) &&
    ['modelCalls', 'transportRetries', 'citationRepairs'].every((key) =>
      count(event[key]),
    ) &&
    event.usage &&
    usageKeys.every((key) => count(event.usage[key])) &&
    event.stages &&
    typeof event.stages === 'object' &&
    !Array.isArray(event.stages) &&
    Object.entries(event.stages).every(
      ([name, value]) =>
        /^[a-z]+\.[a-z.]+$/.test(name) &&
        value &&
        count(value.count) &&
        nonnegative(value.latencyMs) &&
        count(value.failures) &&
        count(value.interrupted),
    ) &&
    Array.isArray(event.reranks) &&
    event.reranks.every(
      (item) =>
        item &&
        ['bge', 'rule'].includes(item.path) &&
        /^[a-z_]+$/.test(item.reason),
    )
  );
}

function distribution(values) {
  if (!values.length) return { count: 0, p50Ms: null, p95Ms: null };
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p) => sorted[Math.ceil(sorted.length * p) - 1];
  return { count: sorted.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95) };
}
const increment = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

class AnswerMetrics {
  constructor() {
    this.started = new Set();
    this.completed = new Map();
    this.invalidEvents = 0;
    this.duplicateTerminals = 0;
  }

  add(event) {
    if (
      !event ||
      typeof event.event !== 'string' ||
      !event.event.startsWith('rag.answer.')
    )
      return;
    if (
      event.schemaVersion !== 1 ||
      typeof event.requestId !== 'string' ||
      !event.requestId
    ) {
      this.invalidEvents++;
      return;
    }
    if (event.event === 'rag.answer.started') this.started.add(event.requestId);
    if (!terminalNames.has(event.event)) return;
    if (!validTerminal(event)) {
      this.invalidEvents++;
      return;
    }
    if (this.completed.has(event.requestId)) {
      this.duplicateTerminals++;
      return;
    }
    this.completed.set(event.requestId, event);
  }

  result() {
    const requests = [...this.completed.values()];
    const stages = new Map();
    const errors = new Map();
    const reasons = new Map();
    const outcomes = new Map();
    const usage = Object.fromEntries(usageKeys.map((key) => [key, 0]));
    let answered = 0,
      refusals = 0,
      failed = 0,
      bge = 0,
      rule = 0,
      eligibleFallbacks = 0;
    let modelCalls = 0,
      retries = 0,
      repairs = 0;
    for (const request of requests) {
      if (request.status === 'success') answered++;
      else if (request.status === 'refusal') refusals++;
      else {
        failed++;
        increment(errors, request.errorCode ?? 'INTERNAL_ERROR');
      }
      increment(outcomes, request.outcome ?? request.status);
      modelCalls += request.modelCalls;
      retries += request.transportRetries;
      repairs += request.citationRepairs;
      for (const key of usageKeys) usage[key] += request.usage[key];
      for (const [name, stats] of Object.entries(request.stages)) {
        const values = stages.get(name) ?? {
          values: [],
          failures: 0,
          interrupted: 0,
          spans: 0,
        };
        values.values.push(stats.latencyMs);
        values.failures += stats.failures;
        values.interrupted += stats.interrupted;
        values.spans += stats.count;
        stages.set(name, values);
      }
      for (const route of request.reranks) {
        increment(reasons, route.reason);
        if (route.path === 'bge') bge++;
        else {
          rule++;
          if (!['configured_rule', 'empty_pool'].includes(route.reason))
            eligibleFallbacks++;
        }
      }
    }
    return {
      completedRequests: requests.length,
      startedRequests: this.started.size,
      incompleteRequests: [...this.started].filter(
        (id) => !this.completed.has(id),
      ).length,
      terminalsWithoutStart: requests.filter(
        (r) => !this.started.has(r.requestId),
      ).length,
      invalidEvents: this.invalidEvents,
      duplicateTerminals: this.duplicateTerminals,
      answered,
      refusals,
      failed,
      serviceSuccessRate: requests.length
        ? (answered + refusals) / requests.length
        : null,
      latency: distribution(requests.map((r) => r.latencyMs)),
      latencyByStatus: Object.fromEntries(
        ['success', 'refusal', 'error'].map((status) => [
          status,
          distribution(
            requests.filter((r) => r.status === status).map((r) => r.latencyMs),
          ),
        ]),
      ),
      errors: Object.fromEntries(errors),
      outcomes: Object.fromEntries(outcomes),
      rerank: {
        bge,
        rule,
        reasons: Object.fromEntries(reasons),
        eligibleFallbacks,
        fallbackRate:
          bge + eligibleFallbacks
            ? eligibleFallbacks / (bge + eligibleFallbacks)
            : null,
      },
      modelCalls,
      transportRetries: retries,
      citationRepairs: repairs,
      usage,
      stages: Object.fromEntries(
        [...stages].map(([name, data]) => [
          name,
          {
            ...distribution(data.values),
            spans: data.spans,
            failures: data.failures,
            interrupted: data.interrupted,
          },
        ]),
      ),
    };
  }
}
module.exports = { parseLogLine, AnswerMetrics, distribution };
