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
      (_generation: string) =>
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
  it.each(['succeeded', 'superseded', 'failed', 'activation_unknown'])(
    'persists terminal state %s with attempt-scoped counters',
    async (state) => {
      const store = {
        activate: vi.fn(async () => {
          if (state === 'activation_unknown')
            throw new Error('COMMIT uncertain');
          return state !== 'superseded';
        }),
      };
      const progress = {
        start: vi.fn(),
        report: vi.fn(),
        finish: vi.fn(),
        prune: vi.fn(),
      };
      const discard = vi.fn();
      const document = { id: 'doc', version: 3 } as any;
      const stage = vi.fn(async (_generation, report) => {
        await report('embedding', 2, 4);
        if (state === 'failed') throw new Error('model unavailable');
      });
      const work = new IndexBuildService(store as any, progress as any).build(
        document,
        'rag',
        stage,
        discard,
      );
      if (state === 'failed' || state === 'activation_unknown')
        await expect(work).rejects.toThrow();
      else expect(await work).toBe(state === 'succeeded');
      const generation = progress.start.mock.calls[0][2];
      expect(progress.start).toHaveBeenCalledWith(document, 'rag', generation);
      expect(progress.report).toHaveBeenCalledWith(
        generation,
        'embedding',
        2,
        4,
      );
      expect(progress.finish).toHaveBeenCalledExactlyOnceWith(
        generation,
        state,
      );
      expect(progress.prune).toHaveBeenCalledOnce();
      expect(discard).toHaveBeenCalledTimes(
        state === 'failed' || state === 'superseded' ? 1 : 0,
      );
      if (state === 'failed') expect(store.activate).not.toHaveBeenCalled();
    },
  );

  it('does not make progress persistence a visibility dependency', async () => {
    const store = { activate: vi.fn().mockResolvedValue(true) };
    const offline = () =>
      vi.fn().mockRejectedValue(new Error('progress DB unavailable'));
    const progress = {
      start: offline(),
      report: offline(),
      finish: offline(),
      prune: offline(),
    };
    const discard = vi.fn();
    expect(
      await new IndexBuildService(store as any, progress as any).build(
        {} as any,
        'rag',
        async (_generation, report) => {
          await report('chunk');
        },
        discard,
      ),
    ).toBe(true);
    expect(store.activate).toHaveBeenCalledOnce();
    expect(discard).not.toHaveBeenCalled();
  });
  it('forwards a durable caller generation and ledger into the activation transaction', async () => {
    const heads = { activate: vi.fn().mockResolvedValue(true) };
    const onActivated = vi.fn();
    await new IndexBuildService(heads as any).build(
      {} as any,
      'rag',
      async (generation) => {
        expect(generation).toBe('requested-generation');
      },
      vi.fn(),
      { generation: 'requested-generation', contentId: 'body', onActivated },
    );
    expect(heads.activate).toHaveBeenCalledWith(
      {},
      'rag',
      'requested-generation',
      onActivated,
    );
  });
  it('signals uncertain activation to the durable caller while preserving staged data', async () => {
    const heads = {
      activate: vi.fn().mockRejectedValue(new Error('lost acknowledgement')),
    };
    const unknown = vi.fn(),
      discard = vi.fn();
    await expect(
      new IndexBuildService(heads as any).build(
        {} as any,
        'rag',
        vi.fn(),
        discard,
        {
          generation: 'attempt',
          contentId: 'body',
          onActivated: vi.fn(),
          onActivationUnknown: unknown,
        },
      ),
    ).rejects.toThrow('acknowledgement');
    expect(unknown).toHaveBeenCalledOnce();
    expect(discard).not.toHaveBeenCalled();
  });
});
