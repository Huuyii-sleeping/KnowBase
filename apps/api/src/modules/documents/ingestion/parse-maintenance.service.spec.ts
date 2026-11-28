import { describe, expect, it, vi } from 'vitest';
import { ParseMaintenanceService } from './parse-maintenance.service';

function fixture() {
  const tasks = { recover: vi.fn(), fingerprint: 'config' };
  const cleanup = {
    remoteCancellations: vi.fn(async () => [
      { id: 'task', remote_task_id: 'remote' },
    ]),
    remoteCanceled: vi.fn(),
    orphanContents: vi.fn(async () => [
      { document_id: 'doc', content_id: 'orphan' },
    ]),
    forgetContent: vi.fn(),
  };
  const content = {
    findByContentId: vi.fn(async () => ({
      assets: [{ objectKey: 'assets/doc/orphan' }],
    })),
    deleteByContentId: vi.fn(),
  };
  const assets = { cleanup: vi.fn() };
  const mineru = { cancel: vi.fn() };
  return {
    tasks,
    cleanup,
    content,
    assets,
    mineru,
    service: new ParseMaintenanceService(
      tasks as any,
      content as any,
      assets as any,
      mineru as any,
      cleanup as any,
    ),
  };
}

describe('Parse maintenance', () => {
  it('cancels abandoned remote tasks and removes attempt references after asset cleanup', async () => {
    const f = fixture();
    await f.service.run();
    expect(f.mineru.cancel).toHaveBeenCalledWith('remote');
    expect(f.cleanup.remoteCanceled).toHaveBeenCalledWith('task');
    expect(f.assets.cleanup).toHaveBeenCalledWith('doc', ['assets/doc/orphan']);
    expect(f.content.deleteByContentId).toHaveBeenCalledWith('orphan');
    expect(f.cleanup.forgetContent).toHaveBeenCalledWith('doc', 'orphan');
  });
  it('retains references when removal fails so the next pass can retry', async () => {
    const f = fixture();
    f.assets.cleanup.mockRejectedValueOnce(new Error('storage down'));
    await expect(f.service.run()).rejects.toThrow('storage down');
    expect(f.content.deleteByContentId).not.toHaveBeenCalled();
    expect(f.cleanup.forgetContent).not.toHaveBeenCalled();
  });
});
