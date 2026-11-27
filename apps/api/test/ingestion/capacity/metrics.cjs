const { createHash } = require('node:crypto');
function distribution(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, max: null };
  if (values.some((x) => !Number.isFinite(x) || x < 0))
    throw Error('Expected finite nonnegative observations');
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.ceil(q * sorted.length) - 1];
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted.at(-1),
  };
}
function fixture(bytes, ordinal) {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 1024 ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 0
  )
    throw Error('Invalid fixture parameters');
  const fact = `CAPACITY-${String(ordinal).padStart(6, '0')}: approved limit is 731 units.`;
  let text = fact + '\n\n';
  let section = 0;
  while (text.length < bytes - fact.length - 2) {
    text += `Section ${section++}. Shipment ${ordinal} follows the recorded approval. Quantity and ownership must remain attached to the source.\n\n`;
  }
  text = text.slice(0, bytes - fact.length - 2) + '\n\n' + fact;
  const data = Buffer.from(text);
  return {
    data,
    fact,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}
// Settle every in-flight request before cleanup; fail-fast Promise.all leaves writers running.
async function boundedMap(items, concurrency, work) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw Error('Invalid concurrency');
  let next = 0;
  const results = Array(items.length);
  let failure;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!failure && next < items.length) {
        const index = next++;
        try {
          results[index] = await work(items[index], index);
        } catch (error) {
          failure ??= error;
        }
      }
    }),
  );
  if (failure) throw failure;
  return results;
}
function stageMetrics(log, ids) {
  const groups = {};
  for (const line of log.split('\n')) {
    const start = line.indexOf('{');
    if (start < 0) continue;
    let event;
    try {
      event = JSON.parse(line.slice(start).replace(/\x1b\[[0-9;]*m/g, ''));
    } catch {
      continue;
    }
    if (
      !ids.has(event.documentId) ||
      !event.stage ||
      !Number.isFinite(event.durationMs)
    )
      continue;
    const key = `${event.stage}:${event.pipeline || 'shared'}:${event.status}`;
    (groups[key] ??= []).push(event.durationMs);
  }
  return Object.fromEntries(
    Object.entries(groups).map(([key, values]) => [key, distribution(values)]),
  );
}
module.exports = { distribution, fixture, boundedMap, stageMetrics };
