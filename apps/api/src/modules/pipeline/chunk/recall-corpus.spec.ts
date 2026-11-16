import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MarkdownChunkerService } from './markdown-chunker.service';

describe('Frozen recall corpus structure', () => {
  it('actually separates headings and multi-chunk evidence with the benchmark splitter', async () => {
    const directory = resolve(
      __dirname,
      '../../../../../../benchmarks/knowbase-recall-v3',
    );
    const cases = JSON.parse(
      await readFile(resolve(directory, 'questions.json'), 'utf8'),
    );
    const splitter = new MarkdownChunkerService({
      get: (_key: string, fallback: unknown) => fallback,
    } as any);
    let headingCases = 0;
    let crossCases = 0;
    for (const question of cases.filter(
      (q: any) =>
        q.split !== 'regression' &&
        ['heading_context', 'cross_chunk'].includes(q.category),
    )) {
      const chunks = await splitter.split(
        await readFile(
          resolve(directory, 'docs', question.gold_docs[0]),
          'utf8',
        ),
      );
      const locations = question.evidence.map((e: any) =>
        chunks.flatMap((c, i) => (c.includes(e.quote) ? [i] : [])),
      );
      expect(
        locations.every((indices: number[]) => indices.length > 0),
        question.id,
      ).toBe(true);
      if (question.category === 'heading_context') {
        headingCases += 1;
        expect(
          locations[0].every(
            (i: number) => !chunks[i].includes(question.section_heading),
          ),
          question.id,
        ).toBe(true);
      } else {
        crossCases += 1;
        expect(
          locations[0].every((i: number) => !locations[1].includes(i)),
          question.id,
        ).toBe(true);
      }
    }
    expect(headingCases).toBe(12);
    expect(crossCases).toBe(12);
  });
});
