import { describe, expect, it, vi } from 'vitest';
import { AnswerFailureFilter } from './answer-failure.filter';
import { AnswerFailure, AnswerFailureCode } from './answer-failure';

describe('answer failure HTTP boundary', () => {
  it.each<[AnswerFailureCode, number]>([
    ['ANSWER_TIMEOUT', 504],
    ['MODEL_TIMEOUT', 504],
    ['MODEL_RATE_LIMITED', 503],
    ['MODEL_UNAVAILABLE', 503],
    ['MODEL_CONFIGURATION_ERROR', 503],
    ['MODEL_INVALID_RESPONSE', 502],
    ['MODEL_OUTPUT_LIMIT', 502],
  ])('maps %s to %s without exposing internal details', (code, status) => {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) };
    new AnswerFailureFilter().catch(
      new AnswerFailure(code, 'secret-key raw-body private-url'),
      host as any,
    );
    expect(response.status).toHaveBeenCalledWith(status);
    const body = response.json.mock.calls[0][0];
    expect(body).toMatchObject({
      statusCode: status,
      code,
      message: expect.any(String),
    });
    expect(body).not.toHaveProperty('answer');
    expect(JSON.stringify(body)).not.toMatch(/secret-key|raw-body|private-url/);
  });
});
