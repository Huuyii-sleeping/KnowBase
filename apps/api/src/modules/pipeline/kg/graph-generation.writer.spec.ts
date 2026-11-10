import { describe, expect, it, vi } from 'vitest';
import { GraphGenerationWriter } from './graph-generation.writer';
describe('GraphGenerationWriter', () => {
  it('closes a failed staging transaction without issuing destructive replacement queries', async () => {
    const transaction = {
      run: vi.fn().mockRejectedValue(new Error('write failed')),
    };
    const session = {
      run: vi.fn(),
      close: vi.fn(),
      executeWrite: vi.fn(async (work) => work(transaction)),
    };
    const writer = new GraphGenerationWriter({ session: () => session } as any);
    await expect(writer.stageDocument('doc', 2, 'gen', [])).rejects.toThrow(
      'write failed',
    );
    expect(transaction.run.mock.calls[0][0]).toContain(
      'generationId: $generation',
    );
    expect(transaction.run.mock.calls[0][0]).not.toContain('DELETE');
    expect(session.close).toHaveBeenCalledTimes(2);
  });
  it('limits discarded chunks and relationships to the requested generation', async () => {
    const transaction = { run: vi.fn() };
    const session = {
      close: vi.fn(),
      executeWrite: vi.fn(async (work) => work(transaction)),
    };
    await new GraphGenerationWriter({ session: () => session } as any).remove(
      'doc',
      'gen',
    );
    for (const [query, params] of transaction.run.mock.calls.slice(0, 3)) {
      expect(query).toContain('generationId = $generation');
      expect(params).toEqual({ documentId: 'doc', generation: 'gen' });
    }
  });
});
