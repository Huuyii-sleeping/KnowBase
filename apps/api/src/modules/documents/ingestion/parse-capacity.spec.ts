import { describe, expect, it } from 'vitest';
import { ParseCapacity } from './parse-capacity';

describe('Parser capacity', () => {
  it('bounds overlapping documents and releases capacity after failure or cancellation', async () => {
    const limiter = new ParseCapacity(1);
    let release!: () => void;
    const first = limiter.run(
      undefined,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const abort = new AbortController();
    let called = false;
    const second = limiter.run(abort.signal, async () => {
      called = true;
    });
    const rejected = expect(second).rejects.toThrow();
    abort.abort();
    release();
    await first;
    await rejected;
    expect(called).toBe(false);
    await expect(
      limiter.run(undefined, async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    await expect(limiter.run(undefined, async () => 'success')).resolves.toBe(
      'success',
    );
  });
});
