import { describe, expect, it, vi } from 'vitest';
vi.mock('../documents/entities/document.entity', () => ({
  Document: class {},
  DocumentStatus: { PUBLISHED: 'PUBLISHED' },
}));
import { IndexGenerationStore } from './index-generation.store';

const snapshot = {
  id: 'doc',
  version: 2,
  contentId: 'body',
  status: 'PUBLISHED',
};
function fixture(current: any = snapshot) {
  const manager = {
    findOne: vi.fn().mockResolvedValue(current),
    query: vi.fn().mockResolvedValue([{ generation: 'gen' }]),
  };
  const source = {
    transaction: vi.fn(async (work) => work(manager)),
    getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue(current) }),
    query: vi.fn().mockResolvedValue([{ generation: 'gen' }]),
  };
  return { store: new IndexGenerationStore(source as any), manager, source };
}
describe('IndexGenerationStore', () => {
  it.each([0, -1, NaN, undefined, 1.5])(
    'rejects malformed message versions: %s',
    async (version) => {
      await expect(
        fixture().store.capture('doc', version as number),
      ).rejects.toThrow('positive integer version');
    },
  );
  it.each([
    null,
    { ...snapshot, status: 'DRAFT' },
    { ...snapshot, version: 3 },
  ])('skips missing or stale source: %j', async (current) => {
    expect(await fixture(current).store.capture('doc', 2)).toBeNull();
  });
  it.each([
    null,
    { ...snapshot, status: 'DRAFT' },
    { ...snapshot, version: 3 },
    { ...snapshot, contentId: 'other' },
  ])('rejects a build that became obsolete: %j', async (current) => {
    const { store, manager } = fixture(current);
    expect(await store.activate(snapshot as any, 'rag', 'gen')).toBe(false);
    expect(manager.query).not.toHaveBeenCalled();
  });
  it('locks the current document and never overwrites a tombstone', async () => {
    const { store, manager } = fixture();
    expect(await store.activate(snapshot as any, 'kg', 'gen')).toBe(true);
    expect(manager.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(manager.query.mock.calls[0][0]).toContain(
      'NOT kh_index_head.deleted',
    );
    manager.query.mockResolvedValueOnce([]);
    expect(await store.activate(snapshot as any, 'kg', 'gen')).toBe(false);
  });
  it('selects only published current-version heads restricted by visibility', async () => {
    const { store, source } = fixture();
    expect(await store.active('rag', [])).toEqual([]);
    expect(source.query).not.toHaveBeenCalled();
    expect(await store.active('rag', ['doc'])).toEqual(['gen']);
    expect(source.query.mock.calls[0][0]).toContain('d.version = h.version');
    expect(source.query.mock.calls[0][1]).toEqual(['rag', ['doc']]);
  });
  it('persists three deletion fences with the callers transaction', async () => {
    const { store, manager } = fixture();
    await store.tombstone(manager as any, 'doc', 2);
    expect(manager.query.mock.calls.map((call) => call[1])).toEqual([
      ['doc', 'search', 2],
      ['doc', 'rag', 2],
      ['doc', 'kg', 2],
    ]);
    expect(manager.query.mock.calls[0][0]).toContain('generation = NULL');
  });
});
