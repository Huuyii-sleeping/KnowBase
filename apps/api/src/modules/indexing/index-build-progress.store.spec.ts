import { describe, expect, it, vi } from 'vitest';
import { IndexBuildProgressStore } from './index-build-progress.store';

describe('index progress validation', () => {
  it.each([
    ['unknown', 0, 0],
    ['embedding', -1, 1],
    ['embedding', 2, 1],
    ['embedding', 0.5, 1],
    ['embedding', 0, Infinity],
    ['embedding', 0, Number.MAX_SAFE_INTEGER + 1],
  ])(
    'rejects invalid progress before persistence (%s %s/%s)',
    async (stage, completed, total) => {
      const source = { query: vi.fn() };
      const store = new IndexBuildProgressStore(source as any);
      await expect(
        store.report(
          'generation',
          stage as any,
          completed as number,
          total as number,
        ),
      ).rejects.toThrow('Invalid index progress');
      expect(source.query).not.toHaveBeenCalled();
    },
  );
});
