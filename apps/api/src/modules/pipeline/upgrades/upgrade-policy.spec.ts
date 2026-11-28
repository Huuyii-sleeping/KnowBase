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
import { ConfigService } from '@nestjs/config';
import { validate } from 'class-validator';
import { UpgradePolicyService } from './upgrade-policy.service';
import { classifyUpgrade } from './upgrade-preview.service';
import { CreateUpgradeDto, UpgradePageDto } from './upgrade.dto';
import { UpgradeManagementService } from './upgrade-management.service';
describe('upgrade preview contract', () => {
  const published = { status: 'PUBLISHED', parseStatus: 'READY' } as any;
  it.each([
    [{ status: 'DRAFT' }, null, 'unpublished'],
    [published, null, 'missing_content'],
    [published, { markdown: ' ' }, 'needs_reparse'],
    [
      { ...published, parseStatus: 'FAILED' },
      { markdown: 'text' },
      'needs_reparse',
    ],
    [published, { markdown: '# Context\nA business fact' }, 'rebuild'],
  ])('classifies snapshots deterministically', (doc, body, expected) =>
    expect(classifyUpgrade(doc as any, body as any)).toBe(expected),
  );
  const policy = (values = {}, embedding = 'embed-v1', graph = 'graph-v1') =>
    new UpgradePolicyService(
      new ConfigService(values),
      { strategy: 'structure-v4:1000:150' } as any,
      { fingerprint: embedding } as any,
      { fingerprint: graph } as any,
    );
  it('freezes reproducible fingerprints without returning credential-bearing endpoints', () => {
    const p = policy({ ELASTICSEARCH_NODE: 'https://user:secret@example.org' });
    expect(p.snapshot()).toEqual(p.snapshot());
    expect(JSON.stringify(p.snapshot())).not.toContain('secret');
    expect(p.matches(p.snapshot().hash)).toBe(true);
    expect(policy().matches(p.snapshot().hash)).toBe(false);
    expect(policy({}, 'embed-v2').snapshot().hash).not.toBe(
      policy().snapshot().hash,
    );
  });
  it('invalidates previews when retrieval context changes even with identical chunks and dimensions', () => {
    expect(policy({ RAG_RETRIEVAL_CONTEXT: 'body' }).snapshot().hash).not.toBe(
      policy().snapshot().hash,
    );
    expect(
      policy({ RAG_RETRIEVAL_CONTEXT: 'title-heading' }).snapshot().hash,
    ).toBe(policy().snapshot().hash);
  });
  it('requires immutable model identities rather than silently trusting aliases', () => {
    const p = new UpgradePolicyService(
      new ConfigService(),
      { strategy: 'v4' } as any,
      {} as any,
      {} as any,
    );
    expect(() => p.snapshot()).toThrow('UPGRADE_MODEL_REVISION_REQUIRED');
    expect(p.matches('old')).toBe(false);
  });
  it('validates scope and bounded pagination', async () => {
    const bad = Object.assign(new CreateUpgradeDto(), {
      documentIds: [],
      intervalMs: 0,
      status: 'anything',
    });
    expect((await validate(bad)).map((e) => e.property).sort()).toEqual([
      'documentIds',
      'intervalMs',
      'status',
    ]);
    expect(
      await validate(
        Object.assign(new UpgradePageDto(), { limit: 101, after: 'wrong' }),
      ),
    ).toHaveLength(2);
    expect(
      await validate(
        Object.assign(new CreateUpgradeDto(), {
          intervalMs: 1000,
          status: 'PUBLISHED',
        }),
      ),
    ).toHaveLength(0);
  });
  it.each(['create', 'list', 'summary', 'items', 'attempts'])(
    'guards %s even when called without HTTP',
    (method) => {
      const service = new UpgradeManagementService(
        {} as any,
        {} as any,
        {} as any,
      );
      expect(() =>
        (service as any)[method]({ role: 'MEMBER' }, 'id', 'start'),
      ).toThrow('UPGRADE_ADMIN_REQUIRED');
    },
  );
  it('guards asynchronous commands', async () => {
    const service = new UpgradeManagementService(
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(
      service.command({ role: 'MEMBER' } as any, 'id', 'start'),
    ).rejects.toThrow('UPGRADE_ADMIN_REQUIRED');
  });
});
