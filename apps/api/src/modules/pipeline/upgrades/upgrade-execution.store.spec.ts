import { describe, it, expect, vi } from 'vitest';
import { UpgradeExecutionStore } from './upgrade-execution.store';
const task = {
  id: 'task',
  dispatch_id: 'dispatch',
  generation: 'generation',
  event_id: 'event',
  pipeline: 'rag',
} as any;
describe('upgrade activation ledger', () => {
  it('uses the PostgreSQL UPDATE affected count and writes success in the supplied activation transaction', async () => {
    const manager = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ id: 'task' }], 1])
        .mockResolvedValueOnce([[], 1]),
    };
    const source = { transaction: vi.fn() };
    await new UpgradeExecutionStore(source as any).activated(
      manager as any,
      task,
    );
    expect(manager.query).toHaveBeenCalledTimes(2);
    expect(manager.query.mock.calls[0][1]).toEqual([
      'task',
      'dispatch',
      'generation',
    ]);
    expect(source.transaction).not.toHaveBeenCalled();
  });
  it('rejects a fenced attempt so the caller transaction cannot activate it', async () => {
    const manager = { query: vi.fn().mockResolvedValue([[], 0]) };
    await expect(
      new UpgradeExecutionStore({} as any).activated(manager as any, task),
    ).rejects.toThrow('UPGRADE_ATTEMPT_SUPERSEDED');
    expect(manager.query).toHaveBeenCalledOnce();
  });
  it('refuses delayed messages and completed work before creating another generation', async () => {
    for (const row of [
      undefined,
      { ...task, state: 'pending' },
      { ...task, state: 'skipped' },
      { ...task, state: 'succeeded' },
    ]) {
      const manager = { query: vi.fn().mockResolvedValue(row ? [row] : []) };
      const source = { transaction: async (work: any) => work(manager) };
      expect(
        await new UpgradeExecutionStore(source as any).claim(
          'task',
          'old-token',
          'rag',
        ),
      ).toBeNull();
      expect(manager.query).toHaveBeenCalledOnce();
    }
  });
});
