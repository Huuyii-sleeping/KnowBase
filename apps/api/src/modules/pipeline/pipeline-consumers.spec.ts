import { describe, expect, it, vi } from 'vitest';
import { SearchPipelineConsumer } from './search/search-pipeline.consumer';
import { RagPipelineConsumer } from './rag/rag-pipeline.consumer';
import { KgPipelineConsumer } from './kg/kg-pipeline.consumer';

describe('pipeline command routing', () => {
  it('passes the requested RAG version and routes vector deletion independently', async () => {
    let handler!: (message: any) => Promise<void>;
    const transport = {
      consume: vi.fn(async (_queue, _keys, callback) => {
        handler = callback;
      }),
    };
    const pipeline = {
      rebuildDocument: vi.fn().mockResolvedValue({}),
      deleteDocument: vi.fn(),
    };
    await new RagPipelineConsumer(transport as any, pipeline as any).consume();
    await handler({
      type: 'DOCUMENT_PIPELINE_COMMAND',
      documentId: 'doc',
      version: 7,
    });
    expect(pipeline.rebuildDocument).toHaveBeenCalledWith('doc', 7);
    await handler({ type: 'DOCUMENT_INDEX_DELETE', documentId: 'doc' });
    expect(pipeline.deleteDocument).toHaveBeenCalledWith('doc');
  });
  it('distinguishes search deletion from a versioned snapshot', async () => {
    let handler!: (message: any) => Promise<void>;
    const transport = {
      consume: vi.fn(async (_queue, _keys, callback) => {
        handler = callback;
      }),
    };
    const pipeline = { indexDocument: vi.fn(), deleteDocument: vi.fn() };
    await new SearchPipelineConsumer(
      transport as any,
      pipeline as any,
    ).consume();
    await handler({ type: 'DOCUMENT_INDEX_DELETE', documentId: 'doc' });
    expect(pipeline.deleteDocument).toHaveBeenCalledWith('doc');
    expect(pipeline.indexDocument).not.toHaveBeenCalled();
  });
  it('dispatches source cleanup without invoking graph rebuild or deletion', async () => {
    let handler!: (message: any) => Promise<void>;
    const transport = {
      consume: vi.fn(async (_queue, _keys, callback) => {
        handler = callback;
      }),
    };
    const pipeline = { rebuildDocument: vi.fn(), deleteDocument: vi.fn() };
    const cleanup = { cleanup: vi.fn() };
    await new KgPipelineConsumer(
      transport as any,
      pipeline as any,
      cleanup as any,
    ).consume();
    await handler({
      type: 'DOCUMENT_SOURCE_DELETE',
      documentId: 'doc',
      storageKey: 'original/doc/a.md',
    });
    expect(cleanup.cleanup).toHaveBeenCalledWith('doc', 'original/doc/a.md');
    expect(pipeline.rebuildDocument).not.toHaveBeenCalled();
    expect(pipeline.deleteDocument).not.toHaveBeenCalled();
  });
});
