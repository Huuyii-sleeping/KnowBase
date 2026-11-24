const { randomUUID } = require('node:crypto');
const { assetCapture } = require('./artifacts.cjs');
async function infer(bytes, filename, configuration) {
  const { parserRuntime } = require('../runtime.cjs');
  const assets = assetCapture();
  const { parser } = parserRuntime(configuration.options, assets.uploader);
  const requests = { mineru: 0, vision: 0, other: 0 };
  const original = globalThis.fetch;
  // This CLI runs serially in its own process; never log headers, URLs, or bodies.
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
    );
    const category = url.pathname.endsWith('/chat/completions')
      ? 'vision'
      : url.origin ===
          new URL(configuration.options.MINERU_BASE_URL || 'http://unused')
            .origin
        ? 'mineru'
        : 'other';
    requests[category]++;
    return original(input, init);
  };
  const started = performance.now();
  try {
    const result = await parser.parse(bytes, filename, randomUUID());
    return { result, assets, requests, elapsedMs: performance.now() - started };
  } catch {
    throw Object.assign(new Error('Inference failed'), {
      telemetry: { requests, elapsedMs: performance.now() - started },
    });
  } finally {
    globalThis.fetch = original;
  }
}
module.exports = { infer };
