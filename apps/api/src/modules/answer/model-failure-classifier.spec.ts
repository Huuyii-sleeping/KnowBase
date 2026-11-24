import { describe, expect, it } from 'vitest';
import { AnswerFailure } from './answer-failure';
import { classifyModelFailure } from './model-failure-classifier';

describe('safe answer model failures', () => {
  it.each([
    [401, 'MODEL_CONFIGURATION_ERROR', false],
    [403, 'MODEL_CONFIGURATION_ERROR', false],
    [400, 'MODEL_CONFIGURATION_ERROR', false],
    [404, 'MODEL_CONFIGURATION_ERROR', false],
    [429, 'MODEL_RATE_LIMITED', true],
    [500, 'MODEL_UNAVAILABLE', false],
    [502, 'MODEL_UNAVAILABLE', true],
    [503, 'MODEL_UNAVAILABLE', true],
    [504, 'MODEL_TIMEOUT', false],
    [408, 'MODEL_TIMEOUT', false],
  ])(
    'classifies HTTP %s without copying the provider error',
    (status, code, transient) => {
      const failure = classifyModelFailure({
        status,
        message: 'secret-key private-url document-body',
      });
      expect(failure).toMatchObject({ code, transient });
      expect(JSON.stringify(failure)).not.toMatch(
        /secret-key|private-url|document-body/,
      );
    },
  );

  it('recognizes nested connection resets but does not retry arbitrary programming errors', () => {
    expect(
      classifyModelFailure({ cause: { code: 'ECONNRESET' } }).transient,
    ).toBe(true);
    expect(classifyModelFailure(new TypeError('bad code')).transient).toBe(
      false,
    );
    expect(classifyModelFailure({ name: 'TimeoutError' }).code).toBe(
      'MODEL_TIMEOUT',
    );
    const original = new AnswerFailure(
      'ANSWER_TIMEOUT',
      'Answer deadline exceeded',
    );
    expect(classifyModelFailure(original)).toBe(original);
    const cycle: any = {};
    cycle.cause = cycle;
    expect(classifyModelFailure(cycle).transient).toBe(false);
  });

  it('parses bounded retry decisions from seconds, HTTP dates and missing headers', () => {
    expect(
      classifyModelFailure({
        status: 429,
        headers: new Headers({ 'retry-after': '1.5' }),
      }).retryAfterMs,
    ).toBe(1500);
    expect(
      classifyModelFailure({ status: 429, headers: { 'retry-after': '60' } })
        .retryAfterMs,
    ).toBe(60000);
    const date = new Date(Date.now() + 60000).toUTCString();
    expect(
      classifyModelFailure({ status: 429, headers: { 'retry-after': date } })
        .retryAfterMs,
    ).toBeGreaterThan(58000);
    expect(
      classifyModelFailure({
        status: 429,
        headers: { 'retry-after': 'not-a-time' },
      }).retryAfterMs,
    ).toBeUndefined();
  });
});
