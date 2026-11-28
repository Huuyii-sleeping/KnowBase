import { describe, it, expect, vi } from 'vitest';
import { upgradeExportParts } from './upgrade-export';
describe('upgrade manifest export', () => {
  it('serializes each record as a separate JSON line and follows metadata cursors', async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({
      id: `item-${i}`,
      title: '标题\n第二行',
      tasks: [],
    }));
    const load = vi
      .fn()
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce([{ id: 'last', title: '末页', tasks: [] }]);
    const parts = await upgradeExportParts(
      { plan: { id: 'plan' } } as any,
      load,
    );
    const rows = parts
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(52);
    expect(rows[1].title).toBe('标题\n第二行');
    expect(rows.at(-1).id).toBe('last');
    expect(load.mock.calls).toEqual([[undefined], ['item-49']]);
  });
  it('propagates a failed page instead of exporting an apparently complete partial list', async () => {
    await expect(
      upgradeExportParts({ plan: { id: 'plan' } } as any, async () => {
        throw new Error('network');
      }),
    ).rejects.toThrow('network');
  });
});
