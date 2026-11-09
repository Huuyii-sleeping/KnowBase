import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxRelayService } from './outbox-relay.service';
afterEach(() => vi.useRealTimers());

function fixture(values: Record<string, unknown> = {}) {
  const outbox = { dispatchOne: vi.fn().mockResolvedValue('empty') };
  const messages = { publishRaw: vi.fn() };
  const config = {
    get: (key: string, fallback: unknown) => values[key] ?? fallback,
  };
  return {
    service: new OutboxRelayService(
      config as any,
      outbox as any,
      messages as any,
    ),
    outbox,
    messages,
  };
}
describe('OutboxRelayService', () => {
  it('delivers stored bytes with a stable event ID and persisted attempt', async () => {
    const { service, outbox, messages } = fixture();
    outbox.dispatchOne.mockImplementationOnce(async (send) => {
      await send({
        event_id: 'event-1',
        routing_key: 'document.index',
        body: '{"v":2}',
        attempt: 1,
      });
      return 'sent';
    });
    await service.tick();
    expect(messages.publishRaw).toHaveBeenCalledWith(
      'document.index',
      '{"v":2}',
      { messageId: 'event-1', attempt: 1 },
    );
  });
  it('keeps polling after an outage and stops on shutdown', async () => {
    vi.useFakeTimers();
    const { service, outbox } = fixture();
    outbox.dispatchOne.mockRejectedValueOnce(new Error('postgres unavailable'));
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(outbox.dispatchOne).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(2000);
    expect(outbox.dispatchOne).toHaveBeenCalledTimes(2);
  });
  it('does not start background delivery when explicitly disabled', async () => {
    const { service, outbox } = fixture({ OUTBOX_RELAY_ENABLED: false });
    service.onModuleInit();
    expect(outbox.dispatchOne).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });
});
