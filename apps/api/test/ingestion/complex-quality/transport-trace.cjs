const { digest } = require('./corpus.cjs');
const MAX_RESPONSE_BYTES = 1024 * 1024;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
async function responseMetadata(response) {
  const clone = response.clone();
  if (!clone.body) return { response: 'empty' };
  const reader = clone.body.getReader();
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        // A tee's cancel may wait for the adapter to consume the other branch.
        void reader.cancel().catch(() => {});
        return { response: 'oversized' };
      }
      parts.push(Buffer.from(item.value));
    }
    const body = Buffer.concat(parts);
    let value;
    try {
      value = JSON.parse(body.toString('utf8'));
    } catch {
      return { response: 'invalid_json', responseSha256: digest(body) };
    }
    const usage = value.usage;
    return {
      response: 'json',
      responseSha256: digest(body),
      finishReason: ['stop', 'length', 'content_filter'].includes(
        value.choices?.[0]?.finish_reason,
      )
        ? value.choices[0].finish_reason
        : 'unspecified',
      ...(usage &&
      ['prompt_tokens', 'completion_tokens', 'total_tokens'].every((k) =>
        count(usage[k]),
      )
        ? {
            usage: {
              prompt: usage.prompt_tokens,
              completion: usage.completion_tokens,
              total: usage.total_tokens,
            },
          }
        : {}),
    };
  } catch {
    return { response: 'read_failed' };
  } finally {
    reader.releaseLock();
  }
}
function transportTrace(configuration, fetcher) {
  const requests = { mineru: 0, vision: 0, other: 0 };
  const visionCalls = [];
  const mineruOrigin = new URL(
    configuration.options.MINERU_BASE_URL || 'http://unused',
  ).origin;
  const visionOrigin = configuration.options.VISION_BASE_URL
    ? new URL(configuration.options.VISION_BASE_URL).origin
    : null;
  return {
    requests,
    visionCalls,
    async fetch(input, init) {
      const url = new URL(
        typeof input === 'string' || input instanceof URL ? input : input.url,
      );
      const category =
        url.origin === visionOrigin &&
        url.pathname.endsWith('/chat/completions')
          ? 'vision'
          : url.origin === mineruOrigin
            ? 'mineru'
            : 'other';
      requests[category]++;
      if (category !== 'vision') return fetcher(input, init);
      const started = performance.now();
      const call = { ordinal: visionCalls.length + 1 };
      visionCalls.push(call);
      // Fingerprint the exact request without retaining image bytes, prompts, headers or URLs.
      if (typeof init?.body === 'string')
        call.requestSha256 = digest(init.body);
      try {
        const response = await fetcher(input, init);
        Object.assign(call, {
          httpStatus: response.status,
          ...(await responseMetadata(response)),
        });
        return response;
      } catch {
        call.response = 'request_failed';
        throw new Error('Vision transport failed');
      } finally {
        call.elapsedMs = performance.now() - started;
      }
    },
  };
}
function tokenUsage(calls) {
  if (!calls.length) return null;
  const measured = calls.filter((x) => x.usage);
  return {
    observedCalls: measured.length,
    unmeasuredCalls: calls.length - measured.length,
    prompt: measured.length
      ? measured.reduce((n, x) => n + x.usage.prompt, 0)
      : null,
    completion: measured.length
      ? measured.reduce((n, x) => n + x.usage.completion, 0)
      : null,
    total: measured.length
      ? measured.reduce((n, x) => n + x.usage.total, 0)
      : null,
  };
}
function enhancementStatus(result, requested) {
  const images = (result.evidence || []).filter((x) => x.kind === 'image');
  const descriptions = images.filter(
    (x) => x.data?.representation === 'visual_description',
  );
  const inputs = images.length - descriptions.length;
  const failures = (result.quality?.issues || [])
    .filter((x) =>
      ['IMAGE_DESCRIPTION_FAILED', 'IMAGE_DESCRIPTION_MISSING'].includes(
        x.code,
      ),
    )
    .map((x) => ({ code: x.code, evidenceId: x.evidenceId }));
  return {
    requested,
    inputs,
    descriptions: descriptions.length,
    failures,
    status: !requested
      ? 'not_requested'
      : !inputs
        ? 'no_image_evidence'
        : failures.length || descriptions.length !== inputs
          ? 'incomplete'
          : 'generated_requires_review',
  };
}
module.exports = { transportTrace, tokenUsage, enhancementStatus };
