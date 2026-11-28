import { describe, it, expect, vi } from 'vitest';
vi.mock('../../documents/entities/document.entity', () => ({
  Document: class {},
  DocumentStatus: { PUBLISHED: 'PUBLISHED' },
}));
import { UpgradePreviewService } from './upgrade-preview.service';
function fixture() {
  const doc = {
    id: 'doc',
    contentId: 'body',
    status: 'PUBLISHED',
    parseStatus: 'READY',
  };
  const scan = {
    boundary: vi.fn().mockResolvedValue(new Date()),
    page: vi.fn().mockResolvedValueOnce([doc]).mockResolvedValueOnce([]),
    previousStrategy: vi.fn().mockResolvedValue('unknown'),
  };
  const content = {
    findByContentId: vi.fn().mockResolvedValue({ markdown: 'a fact' }),
  };
  const plans = {
    create: vi.fn().mockResolvedValue('plan'),
    add: vi.fn(),
    finishPreview: vi.fn(),
    summary: vi.fn().mockResolvedValue({}),
  };
  return {
    doc,
    scan,
    content,
    plans,
    service: new UpgradePreviewService(
      scan as any,
      content as any,
      plans as any,
      { snapshot: () => ({ target: {}, hash: 'hash' }) } as any,
    ),
  };
}
describe('upgrade preview workflow', () => {
  it('scans metadata in pages, drops body references, and marks ready only after persistence', async () => {
    const f = fixture();
    await f.service.create('admin', {});
    expect(f.scan.page.mock.calls[1][1]).toBe('doc');
    expect(f.plans.add).toHaveBeenCalledWith('plan', [
      {
        document: f.doc,
        classification: 'rebuild',
        previousStrategy: 'unknown',
      },
    ]);
    expect(f.plans.finishPreview).toHaveBeenCalledWith('plan', true);
  });
  it('keeps partial previews unstartable on later storage failure', async () => {
    const f = fixture();
    f.plans.add.mockRejectedValue(new Error('database offline'));
    await expect(f.service.create('admin', {})).rejects.toThrow('offline');
    expect(f.plans.finishPreview).toHaveBeenCalledExactlyOnceWith(
      'plan',
      false,
    );
  });
});
