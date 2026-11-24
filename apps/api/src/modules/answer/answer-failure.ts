// Safe failure categories: never expose provider bodies, URLs or credentials.
export type AnswerFailureCode =
  | 'ANSWER_TIMEOUT'
  | 'MODEL_TIMEOUT'
  | 'MODEL_RATE_LIMITED'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_CONFIGURATION_ERROR'
  | 'MODEL_INVALID_RESPONSE'
  | 'MODEL_OUTPUT_LIMIT';

export class AnswerFailure extends Error {
  constructor(
    readonly code: AnswerFailureCode,
    message: string,
    readonly retryAfterMs?: number,
    readonly transient = false,
  ) {
    super(message);
    this.name = 'AnswerFailure';
  }
}
