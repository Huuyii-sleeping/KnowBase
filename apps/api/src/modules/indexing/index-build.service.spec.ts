import { describe, expect, it, vi } from 'vitest';
vi.mock('../documents/entities/document.entity', () => ({
  Document: class {},
  DocumentStatus: { PUBLISHED: 'PUBLISHED' },
}));
import { IndexBuildService } from './index-build.service';

describe('IndexBuildService', () => {
  it('activates only after the entire staged build succeeds', async () => {
    let complete!: () => void;
    const stage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const store = { activate: vi.fn().mockResolvedValue(true) };
    const discard = vi.fn();
    const document = { id: 'doc', version: 2 } as any;
    const work = new IndexBuildService(store as any).build(
      document,
      'rag',
      stage,
      discard,
    );
    expect(store.activate).not.toHaveBeenCalled();
    complete();
    expect(await work).toBe(true);
    expect(store.activate).toHaveBeenCalledWith(
      document,
      'rag',
      stage.mock.calls[0][0],
    );
    expect(discard).not.toHaveBeenCalled();
  });

  it('discards only its own failed build and preserves the original error', async () => {
    const store = { activate: vi.fn() };
    const discard = vi.fn().mockRejectedValue(new Error('cleanup offline'));
    const stage = vi.fn().mockRejectedValue(new Error('partial bulk failure'));
    await expect(
      new IndexBuildService(store as any).build(
        {} as any,
        'rag',
        stage,
        discard,
      ),
    ).rejects.toThrow('partial bulk');
    expect(store.activate).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith(stage.mock.calls[0][0]);
  });

  it('discards an obsolete build rejected during the final version check', async () => {
    const store = { activate: vi.fn().mockResolvedValue(false) };
    const stage = vi.fn();
    const discard = vi.fn();
    expect(
      await new IndexBuildService(store as any).build(
        {} as any,
        'kg',
        stage,
        discard,
      ),
    ).toBe(false);
    expect(discard).toHaveBeenCalledWith(stage.mock.calls[0][0]);
  });

  it('preserves staged data when the activation commit outcome is uncertain', async () => {
    const store = {
      activate: vi
        .fn()
        .mockRejectedValue(new Error('connection lost during COMMIT')),
    };
    const discard = vi.fn();
    await expect(
      new IndexBuildService(store as any).build(
        {} as any,
        'search',
        vi.fn(),
        discard,
      ),
    ).rejects.toThrow('COMMIT');
    expect(discard).not.toHaveBeenCalled();
  });
});
