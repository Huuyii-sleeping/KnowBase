import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GenerationCleanupService } from './generation-cleanup.service';

describe('Retired generation cleanup', () => {
  it('uses pipeline-specific cleanup and retains failures for the next pass', async () => {
    const rows = [
      { generation: 'old-rag', document_id: 'doc', pipeline: 'rag' },
      { generation: 'old-kg', document_id: 'doc', pipeline: 'kg' },
    ];
    const registry = {
      candidates: vi.fn(async () => rows),
      collect: vi.fn(async (_generation, work) => work()),
    };
    const vector = { discardGeneration: vi.fn() };
    const graph = {
      discardGeneration: vi
        .fn()
        .mockRejectedValueOnce(new Error('storage offline')),
    };
    const service = new GenerationCleanupService(
      registry as any,
      vector as any,
      graph as any,
      new ConfigService(),
    );
    await service.run();
    expect(vector.discardGeneration).toHaveBeenCalledWith('rag', 'old-rag');
    expect(graph.discardGeneration).toHaveBeenCalledWith('doc', 'old-kg');
    await service.run();
    expect(graph.discardGeneration).toHaveBeenCalledTimes(2);
    expect(registry.candidates).toHaveBeenCalledWith(86400000);
  });
});
