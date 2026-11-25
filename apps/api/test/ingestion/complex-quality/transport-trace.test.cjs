const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  transportTrace,
  tokenUsage,
  enhancementStatus,
} = require('./transport-trace.cjs');
const config = {
  options: {
    MINERU_BASE_URL: 'http://mineru',
    VISION_BASE_URL: 'http://vision/v1',
  },
};
test('real-response metadata capture preserves adapter bytes and never saves credentials or predictions', async () => {
  const payload = {
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    choices: [
      { message: { content: 'private prediction' }, finish_reason: 'stop' },
    ],
  };
  const trace = transportTrace(config, async () => Response.json(payload));
  const response = await trace.fetch('http://vision/v1/chat/completions', {
    body: JSON.stringify({ model: 'fixed', messages: ['source pixels'] }),
    headers: { Authorization: 'Bearer provider-secret' },
  });
  assert.deepEqual(await response.json(), payload);
  assert.equal(trace.requests.vision, 1);
  assert.deepEqual(trace.visionCalls[0].usage, {
    prompt: 100,
    completion: 20,
    total: 120,
  });
  assert.equal(trace.visionCalls[0].finishReason, 'stop');
  for (const secret of [
    'provider-secret',
    'private prediction',
    'source pixels',
    'http://vision',
  ])
    assert.ok(!JSON.stringify(trace.visionCalls).includes(secret));
  await trace.fetch('http://mineru/v1/tasks');
  await trace.fetch('http://cdn/result');
  assert.deepEqual(trace.requests, { mineru: 1, vision: 1, other: 1 });
});
test('truncated JSON, oversized provider responses, invalid usage and request failure remain diagnostic', async () => {
  for (const [body, outcome] of [
    ['{', 'invalid_json'],
    ['a'.repeat(1048577), 'oversized'],
  ]) {
    const trace = transportTrace(config, async () => new Response(body));
    const response = await trace.fetch('http://vision/v1/chat/completions');
    assert.equal(trace.visionCalls[0].response, outcome);
    assert.equal((await response.text()).length, body.length);
  }
  const trace = transportTrace(config, async () =>
    Response.json({
      usage: { prompt_tokens: -1, completion_tokens: 2, total_tokens: 1 },
    }),
  );
  await trace.fetch('http://vision/v1/chat/completions');
  assert.equal(trace.visionCalls[0].usage, undefined);
  const failed = transportTrace(config, async () => {
    throw new Error('secret endpoint detail');
  });
  await assert.rejects(
    failed.fetch('http://vision/v1/chat/completions'),
    /transport failed/,
  );
  assert.equal(failed.visionCalls[0].response, 'request_failed');
  assert.ok(!JSON.stringify(failed.visionCalls).includes('secret'));
});
test('usage distinguishes measured partial totals from unobserved and no-model cases', () => {
  assert.equal(tokenUsage([]), null);
  assert.deepEqual(tokenUsage([{}]), {
    observedCalls: 0,
    unmeasuredCalls: 1,
    prompt: null,
    completion: null,
    total: null,
  });
  assert.deepEqual(
    tokenUsage([{ usage: { prompt: 4, completion: 2, total: 6 } }, {}]),
    {
      observedCalls: 1,
      unmeasuredCalls: 1,
      prompt: 4,
      completion: 2,
      total: 6,
    },
  );
});
test('OCR completion never conceals failed or missing image enhancement', () => {
  const original = { kind: 'image', id: 'input', data: {} };
  const generated = {
    kind: 'image',
    data: { representation: 'visual_description' },
  };
  assert.equal(enhancementStatus({}, true).status, 'no_image_evidence');
  assert.equal(
    enhancementStatus({ evidence: [original] }, true).status,
    'incomplete',
  );
  assert.equal(
    enhancementStatus({ evidence: [original, generated] }, true).status,
    'generated_requires_review',
  );
  assert.equal(
    enhancementStatus(
      { evidence: [original, { ...original, id: 'second' }, generated] },
      true,
    ).status,
    'incomplete',
  );
  assert.equal(
    enhancementStatus(
      {
        evidence: [original, generated],
        quality: {
          issues: [{ code: 'IMAGE_DESCRIPTION_FAILED', evidenceId: 'other' }],
        },
      },
      true,
    ).status,
    'incomplete',
  );
  assert.equal(
    enhancementStatus({ evidence: [original] }, false).status,
    'not_requested',
  );
});
