import { describe, it, expect, vi } from 'vitest';
import { UpgradeCommandService } from './upgrade-command.service';
function fixture(state = 'preview', matches = true) {
  const manager = {
    query: vi
      .fn()
      .mockResolvedValueOnce([{ state, target_hash: 'hash' }])
      .mockResolvedValue([]),
  };
  const source = { transaction: async (work: any) => work(manager) };
  return {
    manager,
    service: new UpgradeCommandService(
      source as any,
      { matches: () => matches } as any,
    ),
  };
}
describe('upgrade command transitions', () => {
  it.each([
    ['start', 'preview', 'running'],
    ['start', 'running', 'running'],
    ['pause', 'running', 'paused'],
    ['resume', 'paused', 'running'],
    ['retry', 'paused', 'paused'],
    ['retry', 'completed', 'running'],
    ['cancel', 'running', 'cancelled'],
  ] as const)('%s from %s yields %s', async (action, state, next) => {
    const f = fixture(state);
    await f.service.apply('plan', action);
    expect(f.manager.query.mock.calls.at(-1)?.[1]).toEqual(['plan', next]);
  });
  it.each(['start', 'resume', 'retry'] as const)(
    'rejects %s with a different target',
    async (action) => {
      const f = fixture('running', false);
      await expect(f.service.apply('plan', action)).rejects.toThrow(
        'UPGRADE_CONFIG_MISMATCH',
      );
      expect(f.manager.query).toHaveBeenCalledOnce();
    },
  );
  it('does not let an incomplete or cancelled preview start', async () => {
    for (const state of ['preparing', 'preview_failed', 'cancelled'])
      await expect(
        fixture(state).service.apply('plan', 'start'),
      ).rejects.toThrow('UPGRADE_INVALID_TRANSITION');
  });
  it('requires a selected task to belong to the same plan', async () => {
    const f = fixture('completed');
    await expect(
      f.service.apply('plan', 'retry', 'foreign-task'),
    ).rejects.toThrow('UPGRADE_TASK_NOT_FOUND');
  });
});
