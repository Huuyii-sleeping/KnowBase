import { describe, expect, it, vi } from 'vitest';
import { DeliveryReceiptStore } from './delivery-receipt.store';

describe('DeliveryReceiptStore', () => {
  it('serializes duplicates on the consumer/event row before running the handler', async () => {
    const manager = {
      query: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ status: 'RETRY', attempt: 0 }]),
    };
    const source = { transaction: vi.fn(async (work) => work(manager)) };
    const store = new DeliveryReceiptStore(source as any);
    const work = vi.fn();
    await store.withLock('search', 'event', work);
    expect(manager.query.mock.calls[0][0]).toContain('ON CONFLICT DO NOTHING');
    expect(manager.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(work).toHaveBeenCalledWith(manager, { status: 'RETRY', attempt: 0 });
  });
  it('stores bounded failure details with completion/retry state', async () => {
    const manager = { query: vi.fn() };
    const store = new DeliveryReceiptStore({} as any);
    await store.record(
      manager as any,
      'kg',
      'event',
      'DEAD',
      2,
      'x'.repeat(3000),
    );
    expect(manager.query.mock.calls[0][1]).toEqual([
      'kg',
      'event',
      'DEAD',
      2,
      'x'.repeat(2000),
    ]);
  });
});
