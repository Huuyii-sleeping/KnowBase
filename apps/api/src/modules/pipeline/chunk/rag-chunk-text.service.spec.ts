import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MarkdownChunkerService } from './markdown-chunker.service';
import { RagChunkTextService } from './rag-chunk-text.service';

function fixture(mode = 'body', size = 90) {
  const config = {
    get: (key: string, fallback: unknown) =>
      ({
        RAG_RETRIEVAL_CONTEXT: mode,
        RAG_CHUNK_SIZE: size,
        RAG_CHUNK_OVERLAP: size === 1000 ? 150 : 10,
      })[key] ?? fallback,
  };
  const chunker = new MarkdownChunkerService(config as any);
  return { chunker, service: new RagChunkTextService(chunker, config as any) };
}

describe('RagChunkTextService', () => {
  it('preserves body chunks, order and empty documents in the default mode', async () => {
    const { chunker, service } = fixture();
    const markdown =
      '# Root\n## Window\n' + 'A repeated explanation. '.repeat(20);
    const expected = await chunker.split(markdown);
    expect(await service.prepare(markdown, 'Title')).toEqual(
      expected.map((content) => ({ content, retrievalText: content })),
    );
    expect(await service.prepare('', 'Title')).toEqual([]);
  });

  it('adds only the document title in the title ablation, with sanitized bounded labels', async () => {
    const { service } = fixture('title');
    const [chunk] = await service.prepare('Evidence.', '  Document\nName  ');
    expect(chunk).toEqual({
      content: 'Evidence.',
      retrievalText: '文档：Document Name\n\nEvidence.',
    });
    expect(
      (await service.prepare('Body', 'x'.repeat(200)))[0].retrievalText,
    ).toBe('文档：' + 'x'.repeat(160) + '\n\nBody');
    expect(await service.prepare('Evidence.', '')).toEqual([
      { content: 'Evidence.', retrievalText: 'Evidence.' },
    ]);
  });

  it('inherits the correct section for long repeated paragraphs without altering their body', async () => {
    const { chunker, service } = fixture('title-heading');
    const markdown =
      '# Policy\n## Earlier\n' +
      'First paragraph. '.repeat(20) +
      '\n## Window\n' +
      'Same paragraph. '.repeat(35) +
      '\nActual window is 24 minutes.';
    const result = await service.prepare(markdown, 'Purchasing');
    expect(result.map((c) => c.content)).toEqual(await chunker.split(markdown));
    const answer = result.find((c) => c.content.includes('24 minutes'))!;
    expect(answer.content).not.toContain('## Window');
    expect(answer.retrievalText).toContain('章节：Policy > Window');
    expect(answer.retrievalText).not.toContain('Earlier');
    expect(await service.prepare('', 'Title')).toEqual([]);
  });

  it('adds the expected section to every frozen heading-dependent answer while preserving all chunks', async () => {
    const directory = resolve(
      __dirname,
      '../../../../../../benchmarks/knowbase-recall-v3',
    );
    const cases = JSON.parse(
      await readFile(resolve(directory, 'questions.json'), 'utf8'),
    );
    const { chunker, service } = fixture('title-heading', 1000);
    let checked = 0;
    for (const q of cases.filter(
      (q: any) => q.split !== 'regression' && q.category === 'heading_context',
    )) {
      const markdown = await readFile(
        resolve(directory, 'docs', q.gold_docs[0]),
        'utf8',
      );
      const chunks = await service.prepare(markdown, 'Test title');
      expect(chunks.map((c) => c.content)).toEqual(
        await chunker.split(markdown),
      );
      const evidence = chunks.filter((c) =>
        c.content.includes(q.evidence[0].quote),
      );
      expect(evidence.length, q.id).toBeGreaterThan(0);
      for (const chunk of evidence)
        expect(chunk.retrievalText, q.id).toContain(
          q.section_heading.replace(/^#+\s*/, ''),
        );
      checked++;
    }
    expect(checked).toBe(12);
  });

  it('rejects invalid modes and propagates chunker failures', async () => {
    expect(() => fixture('unknown')).toThrow('RAG_RETRIEVAL_CONTEXT');
    const { service, chunker } = fixture('title-heading');
    chunker.splitLocated = async () => {
      throw new Error('split failed');
    };
    await expect(service.prepare('text', 'Title')).rejects.toThrow(
      'split failed',
    );
  });
});
