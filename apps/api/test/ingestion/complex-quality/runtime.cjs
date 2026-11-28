const { randomUUID } = require('node:crypto');
const { assetCapture } = require('./artifacts.cjs');
const { transportTrace } = require('./transport-trace.cjs');
async function infer(bytes, filename, configuration) {
  const { parserRuntime } = require('../runtime.cjs');
  const assets = assetCapture();
  const { parser } = parserRuntime(configuration.options, assets.uploader);
  const original = globalThis.fetch;
  const trace = transportTrace(configuration, original);
  // This CLI runs serially in its own process; never log headers, URLs, or bodies.
  globalThis.fetch = trace.fetch;
  const started = performance.now();
  try {
    const result = await parser.parse(bytes, filename, randomUUID());
    return {
      result,
      assets,
      requests: trace.requests,
      visionCalls: trace.visionCalls,
      elapsedMs: performance.now() - started,
    };
  } catch {
    throw Object.assign(new Error('Inference failed'), {
      telemetry: {
        requests: trace.requests,
        visionCalls: trace.visionCalls,
        elapsedMs: performance.now() - started,
      },
    });
  } finally {
    globalThis.fetch = original;
  }
}
module.exports = { infer };
