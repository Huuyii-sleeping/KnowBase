import { describe, expect, it, vi } from 'vitest';

vi.mock('./entities/document.entity', () => ({
  Document: class Document {},
  DocumentStatus: {
    DRAFT: 'DRAFT',
    PENDING_REVIEW: 'PENDING_REVIEW',
    PUBLISHED: 'PUBLISHED',
  },
  DocumentParseStatus: { READY: 'READY', FAILED: 'FAILED' },
}));
import { DocumentPublishService } from './document-publish.service';

function fixture(overrides = {}) {
  const state = {
    id: 'document-1',
    version: 2,
    status: 'PENDING_REVIEW',
    parseStatus: 'READY',
    rejectionReason: 'old',
    ...overrides,
  };
  const tasks: unknown[] = [];
  let draft: typeof state;
  const manager = { findOne: vi.fn(async () => draft), save: vi.fn() };
  const dataSource = {
    transaction: vi.fn(async (work) => {
      draft = { ...state };
      const checkpoint = tasks.length;
      try {
        const result = await work(manager);
        Object.assign(state, draft);
        return result;
      } catch (error) {
        tasks.length = checkpoint;
        throw error;
      }
    }),
  };
  const publisher = {
    publishDocument: vi.fn(async (_document, _manager) => {
      tasks.push('search', 'rag', 'kg');
    }),
  };
  const access = { assertCanReview: vi.fn() };
  const service = new DocumentPublishService(
    dataSource as any,
    publisher as any,
    access as any,
  );
  return { service, state, tasks, manager, publisher, dataSource, access };
}
const admin = { id: 'admin-1', role: 'ADMIN' } as any;

describe('transactional publication', () => {
  it('commits publication and all three durable tasks in the same transaction', async () => {
    const { service, state, tasks, manager, publisher } = fixture();
    await service.publish('document-1', admin);
    expect(state).toMatchObject({
      status: 'PUBLISHED',
      reviewedBy: 'admin-1',
      rejectionReason: null,
    });
    expect(tasks).toHaveLength(3);
    expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
      where: { id: 'document-1' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(publisher.publishDocument).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PUBLISHED' }),
      manager,
    );
  });

  it('rolls back publication and partial tasks when outbox insertion fails', async () => {
    const { service, state, tasks, publisher } = fixture();
    publisher.publishDocument.mockImplementationOnce(async () => {
      tasks.push('search');
      throw new Error('outbox insert failed');
    });
    await expect(service.publish('document-1', admin)).rejects.toThrow(
      'outbox insert failed',
    );
    expect(state.status).toBe('PENDING_REVIEW');
    expect(tasks).toEqual([]);
  });

  it.each([{ status: 'DRAFT' }, { parseStatus: 'FAILED' }])(
    'rejects invalid state before enqueueing: %j',
    async (overrides) => {
      const { service, publisher } = fixture(overrides);
      await expect(service.publish('document-1', admin)).rejects.toThrow();
      expect(publisher.publishDocument).not.toHaveBeenCalled();
    },
  );

  it('checks reviewer authorization before opening the transaction', async () => {
    const { service, access, dataSource } = fixture();
    access.assertCanReview.mockImplementation(() => {
      throw new Error('forbidden');
    });
    await expect(service.publish('document-1', admin)).rejects.toThrow(
      'forbidden',
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects missing documents', async () => {
    const { service, manager } = fixture();
    manager.findOne.mockResolvedValueOnce(null as any);
    await expect(service.publish('missing', admin)).rejects.toThrow(
      'document not found',
    );
  });

  it('allows an explicit redispatch only for published documents', async () => {
    const { service, tasks } = fixture({ status: 'PUBLISHED' });
    await service.dispatch('document-1', admin);
    expect(tasks).toHaveLength(3);
    const unpublished = fixture();
    await expect(
      unpublished.service.dispatch('document-1', admin),
    ).rejects.toThrow('only published');
  });
});
