export type BgeFailureReason =
  | 'runtime_busy'
  | 'timeout'
  | 'unavailable'
  | 'invalid_response'
  | 'request_too_large';

export class BgeFailure extends Error {
  constructor(readonly reason: BgeFailureReason) {
    super(`BGE scoring failed: ${reason}`);
  }
}
