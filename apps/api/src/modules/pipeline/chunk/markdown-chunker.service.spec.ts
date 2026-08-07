import { describe, expect, it, vi } from 'vitest';
import { MarkdownChunkerService } from './markdown-chunker.service';

describe('MarkdownChunkerService', () => {
  it('splits markdown by headings and keeps chunks within the configured size', async () => {
    const config = {
      get: vi.fn((key: string, fallback: unknown) => {
        if (key === 'RAG_CHUNK_SIZE') return 45;
        if (key === 'RAG_CHUNK_OVERLAP') return 5;
        return fallback;
      }),
    };
    const service = new MarkdownChunkerService(config as any);

    const chunks = await service.split(
      '# Intro\n\nA short paragraph.\n\n## Details\n\nA second paragraph.',
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n')).toContain('# Intro');
    expect(chunks.join('\n')).toContain('## Details');
    expect(chunks.every((chunk) => chunk.length <= 45)).toBe(true);
  });
});
