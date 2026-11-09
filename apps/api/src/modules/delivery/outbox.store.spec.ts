import { describe, expect, it, vi } from 'vitest';
import { OutboxStore } from './outbox.store';

const row = {
  id: 'row-1',
  event_id: 'event-1',
  routing_key: 'document.index',
  body: '{"test":true}',
  attempt: 0,
  publish_attempts: 2,
};
function fixture(rows = [row]) {
  const manager = {
    query: vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]),
  };
  const source = { transaction: vi.fn(async (work) => work(manager)) };
  return { store: new OutboxStore(source as any), manager };
}

describe('OutboxStore', () => {
  it('writes a stable event identifier and JSON body using the supplied transaction', async () => {
    const { store } = fixture();
    const manager = { query: vi.fn() };
    const eventId = await store.enqueue(manager as any, 'document.index', {
      version: 2,
    });
    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(manager.query.mock.calls[0][1]).toEqual([
      expect.any(String),
      eventId,
      'document.index',
      '{"version":2}',
      0,
      0,
      null,
    ]);
  });
  it('marks sent only after the send promise confirms', async () => {
    const { store, manager } = fixture();
    let confirm!: () => void;
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          confirm = resolve;
        }),
    );
    const result = store.dispatchOne(send, () => 1000);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(manager.query).toHaveBeenCalledTimes(1);
    confirm();
    await expect(result).resolves.toBe('sent');
    expect(manager.query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(manager.query.mock.calls[1][0]).toContain(
      'published_at = clock_timestamp()',
    );
  });
  it('keeps failed sends pending with durable backoff', async () => {
    const { store, manager } = fixture();
    await expect(
      store.dispatchOne(
        vi.fn().mockRejectedValue(new Error('broker down')),
        (n) => n * 1000,
      ),
    ).resolves.toBe('retry');
    expect(manager.query.mock.calls[1][1]).toEqual([
      'row-1',
      'broker down',
      3000,
    ]);
    expect(manager.query.mock.calls[1][0]).not.toContain(
      'published_at = clock_timestamp()',
    );
  });
  it('propagates failed sent-marker commits so a confirmed delivery is safely resent', async () => {
    const { store, manager } = fixture();
    manager.query.mockRejectedValueOnce(new Error('unavailable'));
    await expect(store.dispatchOne(vi.fn(), () => 1000)).rejects.toThrow();
    const next = fixture();
    next.manager.query
      .mockReset()
      .mockResolvedValueOnce([row])
      .mockRejectedValueOnce(new Error('commit lost'));
    const send = vi.fn();
    await expect(next.store.dispatchOne(send, () => 1000)).rejects.toThrow(
      'commit lost',
    );
    expect(send).toHaveBeenCalledWith(row);
  });
  it('does nothing when there are no due tasks', async () => {
    const { store } = fixture([]);
    const send = vi.fn();
    await expect(store.dispatchOne(send, () => 1000)).resolves.toBe('empty');
    expect(send).not.toHaveBeenCalled();
  });
});
