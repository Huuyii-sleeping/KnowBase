vi.mock('../../documents/entities/document.entity', () => ({
  Document: class {},
  DocumentStatus: {
    PUBLISHED: 'PUBLISHED',
    DRAFT: 'DRAFT',
    PENDING_REVIEW: 'PENDING_REVIEW',
    REJECTED: 'REJECTED',
  },
}));
vi.mock('../../users/entities/user.entity', () => ({
  UserRole: { ADMIN: 'ADMIN', MEMBER: 'MEMBER' },
}));
import { describe, it, expect, vi } from 'vitest';
import { UpgradeRunnerService } from './upgrade-runner.service';
function fixture() {
  const task = {
    id: 'task',
    dispatch_id: 'token',
    document_id: 'doc',
    version: 2,
    content_id: 'body',
    target_hash: 'hash',
    generation: 'attempt',
  };
  const store = {
    claim: vi.fn().mockResolvedValue(task),
    activated: vi.fn(),
    finish: vi.fn(),
  };
  const policy = { matches: vi.fn().mockReturnValue(true) };
  const heads = {
    capture: vi.fn().mockResolvedValue({
      id: 'doc',
      contentId: 'body',
      version: 2,
      status: 'PUBLISHED',
      parseStatus: 'READY',
    }),
  };
  const content = {
    findByContentId: vi
      .fn()
      .mockResolvedValue({ markdown: '# Business facts' }),
  };
  const search = { indexDocument: vi.fn() },
    rag = { rebuildDocument: vi.fn() },
    kg = { rebuildDocument: vi.fn() };
  const runner = new UpgradeRunnerService(
    store as any,
    policy as any,
    heads as any,
    content as any,
    search as any,
    rag as any,
    kg as any,
  );
  return { task, store, policy, heads, content, search, rag, kg, runner };
}
const message = { taskId: 'task', dispatchId: 'token' };
describe('upgrade execution', () => {
  it('ignores completed tasks and stale dispatch tokens', async () => {
    const f = fixture();
    f.store.claim.mockResolvedValue(null);
    await f.runner.run(message, 'rag');
    expect(f.heads.capture).not.toHaveBeenCalled();
    expect(f.rag.rebuildDocument).not.toHaveBeenCalled();
  });
  it('rejects mismatched worker configuration before content/model access', async () => {
    const f = fixture();
    f.policy.matches.mockReturnValue(false);
    await f.runner.run(message, 'rag');
    expect(f.store.finish).toHaveBeenCalledWith(
      f.task,
      'failed',
      'CONFIG_MISMATCH',
    );
    expect(f.content.findByContentId).not.toHaveBeenCalled();
  });
  it.each([null, { id: 'doc', contentId: 'new', version: 2 }])(
    'skips changed or deleted snapshots',
    async (document) => {
      const f = fixture();
      f.heads.capture.mockResolvedValue(document);
      await f.runner.run(message, 'kg');
      expect(f.store.finish).toHaveBeenCalledWith(
        f.task,
        'skipped',
        'DOCUMENT_CHANGED_OR_DELETED',
      );
      expect(f.kg.rebuildDocument).not.toHaveBeenCalled();
    },
  );
  it('skips lost bodies before invoking a model', async () => {
    const f = fixture();
    f.content.findByContentId.mockResolvedValue(null);
    await f.runner.run(message, 'rag');
    expect(f.store.finish).toHaveBeenCalledWith(
      f.task,
      'skipped',
      'CONTENT_UNAVAILABLE_OR_REPARSE_REQUIRED',
    );
  });
  it.each(['search', 'rag', 'kg'] as const)(
    'passes generation and transactional activation ledger to %s',
    async (pipeline) => {
      const f = fixture();
      let options: any;
      const fn = async (...args: any[]) => {
        options = args.at(-1);
        await options.onActivated('manager');
      };
      f.search.indexDocument.mockImplementation(fn);
      f.rag.rebuildDocument.mockImplementation(fn);
      f.kg.rebuildDocument.mockImplementation(fn);
      await f.runner.run(message, pipeline);
      expect(options.generation).toBe('attempt');
      expect(f.store.activated).toHaveBeenCalledWith('manager', f.task);
      expect(f.store.finish).toHaveBeenCalledWith(
        f.task,
        'skipped',
        'DOCUMENT_CHANGED_DURING_BUILD',
      );
    },
  );
  it.each([false, true])(
    'persists safe errors and leaves automatic retry to delivery (unknown=%s)',
    async (unknown) => {
      const f = fixture();
      f.rag.rebuildDocument.mockImplementation(async (_id, _v, options) => {
        if (unknown) options.onActivationUnknown();
        throw new Error('provider secret body');
      });
      await expect(f.runner.run(message, 'rag')).rejects.toThrow(
        unknown ? 'ACTIVATION_UNKNOWN' : 'BUILD_FAILED',
      );
      expect(f.store.finish).toHaveBeenCalledWith(
        f.task,
        unknown ? 'activation_unknown' : 'failed',
        unknown ? 'ACTIVATION_UNKNOWN' : 'BUILD_FAILED',
      );
      expect(JSON.stringify(f.store.finish.mock.calls)).not.toContain('secret');
    },
  );
});
