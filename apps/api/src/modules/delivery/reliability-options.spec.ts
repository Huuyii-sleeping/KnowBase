import { describe, expect, it } from 'vitest';
import { positiveInteger, retryDelay } from './reliability-options';

describe('reliability configuration', () => {
  it('uses bounded exponential backoff', () => {
    expect([1, 2, 3, 1000].map((n) => retryDelay(n, 5000))).toEqual([
      5000, 10000, 20000, 60000,
    ]);
  });
  it.each([0, -1, 1.5, 'NaN', Infinity])(
    'rejects invalid limits: %s',
    (value) => {
      expect(() =>
        positiveInteger({ get: () => value } as any, 'LIMIT', 3),
      ).toThrow('positive integer');
    },
  );
  it('accepts integer strings', () => {
    expect(positiveInteger({ get: () => '3' } as any, 'LIMIT', 1)).toBe(3);
  });
});
