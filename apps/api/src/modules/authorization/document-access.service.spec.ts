import { describe, expect, it, vi } from 'vitest';

vi.mock('../documents/entities/document.entity', () => ({
  Document: class Document {},
  DocumentStatus: { PUBLISHED: 'PUBLISHED' },
}));

import { ForbiddenException } from '@nestjs/common';
import { DocumentAccessService, DocumentVisibility } from './document-access.service';

const admin = { id: 'admin-1', username: 'admin', displayName: 'Admin', role: 'ADMIN', team: null } as any;
const member = (overrides: Record<string, unknown> = {}) => ({
  id: 'member-1',
  username: 'member',
  displayName: 'Member',
  role: 'MEMBER',
  team: 'platform',
  ...overrides,
}) as any;

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    uploaderId: 'owner-1',
    status: 'PUBLISHED',
    team: 'platform',
    permissions: { visibility: DocumentVisibility.PRIVATE, userIds: [], teams: [] },
    storageKey: 'original/11111111-1111-4111-8111-111111111111/guide.md',
    ...overrides,
  } as any;
}

function service(findOne = vi.fn()) {
  return new DocumentAccessService({ findOne } as any);
}

describe('DocumentAccessService', () => {
  it('allows administrators to view every document', () => {
    expect(service().canView(document(), admin)).toBe(true);
  });

  it('allows the uploader to view private documents', () => {
    expect(service().canView(document(), member({ id: 'owner-1' }))).toBe(true);
    expect(service().canView(document(), member())).toBe(false);
  });

  it('allows every member to view public documents', () => {
    expect(service().canView(document({ permissions: { visibility: DocumentVisibility.PUBLIC } }), member())).toBe(true);
  });

  it('only allows members of the document team to view team documents', () => {
    const teamDocument = document({
      permissions: { visibility: DocumentVisibility.TEAM, teams: [] },
    });
    expect(service().canView(teamDocument, member())).toBe(true);
    expect(service().canView(teamDocument, member({ team: 'sales' }))).toBe(false);
    expect(service().canView(teamDocument, member({ team: null }))).toBe(false);
  });

  it('supports an explicit user allow-list for published documents', () => {
    const restricted = document({
      permissions: { visibility: DocumentVisibility.PRIVATE, userIds: ['member-1'] },
    });
    expect(service().canView(restricted, member())).toBe(true);
    expect(service().canView(restricted, member({ id: 'member-2' }))).toBe(false);
  });

  it('allows an uploader to view their own non-published document only', () => {
    const draft = document({ status: 'DRAFT' });
    expect(service().canView(draft, member({ id: 'owner-1' }))).toBe(true);
    expect(service().canView(draft, member())).toBe(false);
  });

  it('rejects non-admin review and non-owner edits', () => {
    expect(() => service().assertCanReview(member())).toThrow(ForbiddenException);
    expect(() => service().assertCanEdit(document(), member())).toThrow(ForbiddenException);
    expect(() => service().assertCanEdit(document(), member({ id: 'owner-1' }))).not.toThrow();
  });

  it('checks object access by storage key and document id', async () => {
    const findOne = vi.fn()
      .mockResolvedValueOnce(document())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(document({
        permissions: { visibility: DocumentVisibility.TEAM, teams: [] },
      }));
    const access = service(findOne);

    await expect(access.assertCanViewStorageKey('original/11111111-1111-4111-8111-111111111111/guide.md', admin)).resolves.toBeUndefined();
    await expect(access.assertCanViewStorageKey('assets/11111111-1111-4111-8111-111111111111/image.png', member())).resolves.toBeUndefined();
    await expect(access.assertCanViewStorageKey('original/invalid-key/guide.md', member())).rejects.toThrow(ForbiddenException);
  });

  it('does not expose malformed or unknown object keys', () => {
    const access = service();
    expect(access.objectDocumentId('original/11111111-1111-4111-8111-111111111111/guide.md')).toBe('11111111-1111-4111-8111-111111111111');
    expect(access.objectDocumentId('assets/11111111-1111-4111-8111-111111111111/image.png')).toBe('11111111-1111-4111-8111-111111111111');
    expect(access.objectDocumentId('original/not-a-uuid/file.txt')).toBeNull();
  });
});
