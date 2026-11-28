import { describe, expect, it, vi } from 'vitest';
vi.mock('../entities/document.entity', () => ({ Document: class {} }));
import { DocumentIndexStatusService } from './document-index-status.service';
import { DocumentIndexStatusController } from './document-index-status.controller';

function fixture() {
  const document = { id: 'doc', version: 3 };
  const documents = { findOneBy: vi.fn().mockResolvedValue(document) };
  const access = { assertCanView: vi.fn(), assertCanEdit: vi.fn() };
  const builds = {
    latest: vi.fn().mockResolvedValue([
      {
        pipeline: 'rag',
        version: 3,
        state: 'failed',
        stage: 'embedding',
        completed: 2,
        total: 4,
      },
      {
        pipeline: 'search',
        version: 2,
        state: 'succeeded',
        stage: 'complete',
        completed: 1,
        total: 1,
      },
    ]),
  };
  const service = new DocumentIndexStatusService(
    documents as any,
    access as any,
    builds as any,
  );
  return { documents, access, builds, service, document };
}
const user = { id: 'owner', role: 'USER' } as any;
describe('document build status', () => {
  it('returns only authorized attempts and identifies older revisions', async () => {
    const { service, access, document, builds } = fixture();
    const result = await new DocumentIndexStatusController(service).read(
      'doc',
      user,
    );
    expect(access.assertCanView).toHaveBeenCalledWith(document, user);
    expect(access.assertCanEdit).toHaveBeenCalledWith(document, user);
    expect(builds.latest).toHaveBeenCalledWith('doc');
    expect(result).toMatchObject({
      documentId: 'doc',
      version: 3,
      attempts: [{ currentVersion: true }, { currentVersion: false }],
    });
  });
  it('does not query attempts for a missing or deleted document', async () => {
    const { service, documents, builds, access } = fixture();
    documents.findOneBy.mockResolvedValue(null);
    await expect(service.read('doc', user)).rejects.toThrow(
      'document not found',
    );
    expect(access.assertCanView).not.toHaveBeenCalled();
    expect(builds.latest).not.toHaveBeenCalled();
  });
  it.each(['assertCanView', 'assertCanEdit'] as const)(
    'rejects access before querying internal attempts (%s)',
    async (method) => {
      const { service, access, builds } = fixture();
      access[method].mockImplementation(() => {
        throw new Error('forbidden');
      });
      await expect(service.read('doc', user)).rejects.toThrow('forbidden');
      expect(builds.latest).not.toHaveBeenCalled();
    },
  );
});
