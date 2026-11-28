import { ConfigService } from '@nestjs/config';
import { describe, it, expect, vi } from 'vitest';
import { UpgradeSchedulerService } from './upgrade-scheduler.service';
describe('upgrade scheduling lifecycle', () => {
  it('allows one pass per process and releases its latch after a database failure', async () => {
    let reject!: (reason: Error) => void;
    const dispatch = {
      dispatch: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, no) => {
              reject = no;
            }),
        )
        .mockResolvedValueOnce(true),
    };
    const service = new UpgradeSchedulerService(
      dispatch as any,
      { matches: () => true } as any,
      new ConfigService(),
    );
    const first = service.tick();
    expect(await service.tick()).toBe(false);
    reject(new Error('offline'));
    await expect(first).rejects.toThrow('offline');
    expect(await service.tick()).toBe(true);
    expect(dispatch.dispatch.mock.calls[1][0]).toBe(6);
  });
  it('does not start timers on API-only processes', () => {
    const timer = vi.spyOn(global, 'setInterval');
    const service = new UpgradeSchedulerService(
      {} as any,
      {} as any,
      new ConfigService({ PIPELINE_WORKERS_ENABLED: false }),
    );
    service.onModuleInit();
    expect(timer).not.toHaveBeenCalled();
    service.onModuleDestroy();
    timer.mockRestore();
  });
});
