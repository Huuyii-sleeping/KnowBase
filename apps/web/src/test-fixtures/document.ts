import type { DocumentDetail } from '@/lib/api';

export function documentFixture(
  overrides: Partial<DocumentDetail> = {},
): DocumentDetail {
  return {
    id: 'saved',
    title: 'Uploaded document',
    fileName: 'notes.txt',
    mimeType: 'text/plain',
    fileSize: 11,
    storageKey: 'original/saved/notes.txt',
    contentId: 'content-saved',
    uploaderId: 'user-1',
    category: null,
    team: null,
    rejectionReason: null,
    version: 1,
    permissions: {},
    statistics: {},
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: '2026-11-10T12:00:00Z',
    updatedAt: '2026-11-10T12:00:00Z',
    status: 'DRAFT',
    parseStatus: 'READY',
    parseError: null,
    tags: [],
    content: {
      contentId: 'content-saved',
      version: 1,
      warnings: [],
      assets: [],
      markdown: 'Parsed body',
      parser: 'test',
      characterCount: 11,
    },
    ...overrides,
  };
}
