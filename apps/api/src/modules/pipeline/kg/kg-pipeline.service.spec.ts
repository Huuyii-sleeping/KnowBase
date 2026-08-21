import { describe, expect, it, vi } from 'vitest';

vi.mock('../../documents/entities/document.entity', () => ({
  Document: class Document {},
  DocumentStatus: { PUBLISHED: 'PUBLISHED' },
}));

import { KgPipelineService } from './kg-pipeline.service';

describe('KgPipelineService', () => {
  it('runs the published document through chunking, extraction, and graph indexing', async () => {
    const document = {
      id: 'document-1',
      version: 3,
      contentId: 'content-3',
      status: 'PUBLISHED',
    };
    const graphChunks = [{
      id: 'document-1:v3:c0',
      documentId: 'document-1',
      version: 3,
      chunkIndex: 0,
      content: '# KnowBase',
    }];
    const extraction = {
      entities: [{ key: '产品:knowbase', name: 'KnowBase', type: '产品' }],
      mentions: [{ chunkId: graphChunks[0].id, entityKey: '产品:knowbase' }],
      relations: [],
    };
    const graphIndex = { replaceDocument: vi.fn().mockResolvedValue(undefined) };
    const service = new KgPipelineService(
      { findEntity: vi.fn().mockResolvedValue(document) } as any,
      { findByContentId: vi.fn().mockResolvedValue({ markdown: '# KnowBase' }) } as any,
      { split: vi.fn().mockResolvedValue(['# KnowBase']) } as any,
      { extract: vi.fn().mockResolvedValue(extraction) } as any,
      graphIndex as any,
    );

    await expect(service.rebuildDocument('document-1')).resolves.toEqual({
      chunks: 1,
      entities: 1,
      relations: 0,
    });
    expect(graphIndex.replaceDocument).toHaveBeenCalledWith(
      'document-1',
      3,
      graphChunks,
      extraction.entities,
      extraction.mentions,
      extraction.relations,
    );
  });

  it('does not build a graph for an unpublished document', async () => {
    const service = new KgPipelineService(
      { findEntity: vi.fn().mockResolvedValue({ status: 'DRAFT' }) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.rebuildDocument('document-1')).rejects.toThrow(
      'only published documents can build the knowledge graph',
    );
  });

  it('skips a stale rebuild message before changing Neo4j', async () => {
    const graphIndex = { replaceDocument: vi.fn() };
    const service = new KgPipelineService(
      { findEntity: vi.fn().mockResolvedValue({ status: 'PUBLISHED', version: 2 }) } as any,
      {} as any,
      {} as any,
      {} as any,
      graphIndex as any,
    );

    await expect(service.rebuildDocument('document-1', 1)).resolves.toEqual({
      chunks: 0,
      entities: 0,
      relations: 0,
      skipped: true,
    });
    expect(graphIndex.replaceDocument).not.toHaveBeenCalled();
  });

  it('does not replace an existing graph when extraction fails', async () => {
    const graphIndex = { replaceDocument: vi.fn() };
    const service = new KgPipelineService(
      { findEntity: vi.fn().mockResolvedValue({ id: 'document-1', version: 1, contentId: 'content-1', status: 'PUBLISHED' }) } as any,
      { findByContentId: vi.fn().mockResolvedValue({ markdown: '# source' }) } as any,
      { split: vi.fn().mockResolvedValue(['# source']) } as any,
      { extract: vi.fn().mockRejectedValue(new Error('invalid extraction')) } as any,
      graphIndex as any,
    );

    await expect(service.rebuildDocument('document-1', 1)).rejects.toThrow('invalid extraction');
    expect(graphIndex.replaceDocument).not.toHaveBeenCalled();
  });
});
