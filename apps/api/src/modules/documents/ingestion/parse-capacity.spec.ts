import { describe, expect, it } from 'vitest';
import { ParseCapacity } from './parse-capacity';

describe('Parser capacity', () => {
  it('rejects canceled queued callers immediately while the active long parse keeps its slot', async () => {
    const limiter = new ParseCapacity(1);
    let release!: () => void;
    const active = limiter.run(
      undefined,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const queued = limiter.run(controller.signal, async () => {
      throw new Error('canceled caller ran');
    });
    const rejection = expect(queued).rejects.toThrow('queued canceled');
    controller.abort(new Error('queued canceled'));
    await rejection;
    const order: number[] = [];
    const next = limiter.run(undefined, async () => {
      order.push(1);
    });
    const last = limiter.run(undefined, async () => {
      order.push(2);
    });
    expect(order).toEqual([]);
    release();
    await Promise.all([active, next, last]);
    expect(order).toEqual([1, 2]);
    await expect(limiter.run(undefined, async () => 'released')).resolves.toBe(
      'released',
    );
  });
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
