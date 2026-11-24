import { describe, expect, it, vi } from 'vitest';
import { MarkdownChunkerService } from './markdown-chunker.service';

describe('MarkdownChunkerService', () => {
  it('turns merged HTML tables into bounded search rows with canonical table evidence', async () => {
    const service = new MarkdownChunkerService({
      get: (key: string, fallback: unknown) =>
        key === 'RAG_CHUNK_SIZE'
          ? 100
          : key === 'RAG_CHUNK_OVERLAP'
            ? 0
            : fallback,
    } as any);
    const markdown =
      '# 季度\n\n<table><tr><th rowspan="2">部门</th><th colspan="2">预算</th></tr><tr><th>Q1</th><th>Q2</th></tr>' +
      Array.from(
        { length: 12 },
        (_, i) => `<tr><td>部门${i}</td><td>${i}</td><td>${i + 1}</td></tr>`,
      ).join('') +
      '</table>';
    const chunks = await service.splitStructured(markdown, [
      { start: 0, end: markdown.length, source: { page: 3 } },
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every(
        (chunk) =>
          chunk.content.length <= 100 &&
          chunk.content.includes('预算 / Q1') &&
          !chunk.content.includes('<td'),
      ),
    ).toBe(true);
    expect(chunks[0].ranges[0].source).toMatchObject({
      page: 3,
      tableId: expect.stringMatching(/^table-/),
      tableRowStart: 3,
    });
    expect(chunks.at(-1)?.ranges[0].source?.tableRowEnd).toBe(14);
    expect(
      chunks.every((chunk) => chunk.strategy.startsWith('structure-v4:')),
    ).toBe(true);
  });
  it('preserves the nearest heading when the document title is very long', async () => {
    const service = new MarkdownChunkerService({
      get: (key: string, fallback: unknown) =>
        key === 'RAG_CHUNK_SIZE'
          ? 100
          : key === 'RAG_CHUNK_OVERLAP'
            ? 0
            : fallback,
    } as any);
    const chunks = await service.splitStructured(
      '# ' + 'Long title '.repeat(30) + '\n\n## 发布\n\n审核正文。',
    );
    expect(chunks[0].content).toContain('## 发布');
    expect(chunks[0].headingPath[0].length).toBeGreaterThan(100);
    expect(chunks[0].content.length).toBeLessThanOrEqual(100);
  });

  const create = (size = 120, overlap = 12) =>
    new MarkdownChunkerService({
      get: (key: string, fallback: unknown) =>
        key === 'RAG_CHUNK_SIZE'
          ? size
          : key === 'RAG_CHUNK_OVERLAP'
            ? overlap
            : fallback,
    } as any);

  it('keeps Chinese sentence punctuation with each sentence and repairs an open code fence', async () => {
    const sentences = [
      '第一句话说明发布。',
      '第二句话解释审核。',
      '第三句话介绍索引。',
      '第四句话说明重试。',
      '第五句话交代权限。',
    ];
    const chunks = await create(32, 0).split(sentences.join(''));
    for (const sentence of sentences)
      expect(chunks.some((chunk) => chunk.includes(sentence))).toBe(true);
    expect(await create().split('```ts\nconst a = 1;')).toEqual([
      '```ts\nconst a = 1;\n```',
    ]);
  });

  it('repeats table headers without losing rows and keeps code fences complete', async () => {
    const table =
      '| Key | Value |\n| --- | --- |\n' +
      Array.from({ length: 20 }, (_, i) => `| key${i} | value${i} |`).join(
        '\n',
      );
    const code =
      '```ts\n' +
      Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join('\n') +
      '\n```';
    const result = await create().splitStructured(
      '# Guide\n\n## Table\n\n' + table + '\n\n## Code\n\n' + code,
    );
    const tables = result.filter(
      (chunk) => chunk.headingPath.at(-1) === 'Table',
    );
    expect(tables.length).toBeGreaterThan(1);
    expect(
      tables.every((chunk) =>
        chunk.content.includes('| Key | Value |\n| --- | --- |'),
      ),
    ).toBe(true);
    const codes = result.filter((chunk) => chunk.headingPath.at(-1) === 'Code');
    expect(
      codes.every(
        (chunk) =>
          chunk.content.includes('```ts\n') && chunk.content.endsWith('\n```'),
      ),
    ).toBe(true);
    for (let i = 0; i < 20; i++) {
      expect(
        tables.some((chunk) =>
          chunk.content.includes(`| key${i} | value${i} |`),
        ),
      ).toBe(true);
      expect(
        codes.some((chunk) => chunk.content.includes(`const v${i} = ${i};`)),
      ).toBe(true);
    }
    expect(result.every((chunk) => chunk.content.length <= 120)).toBe(true);
  });

  it('keeps content deterministic, carries source ranges and isolates neighboring chapters', async () => {
    const markdown =
      '## A\n\n' + '甲乙丙丁。'.repeat(40) + '\n\n## B\n\n另一个章节。';
    const service = create();
    const result = await service.splitStructured(markdown);
    expect(await service.splitStructured(markdown)).toEqual(result);
    expect(result.at(-1)?.content).not.toContain('甲乙丙丁');
    expect(result.at(-1)?.headingPath).toEqual(['B']);
    for (const chunk of result) {
      expect(chunk.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(chunk.ranges.every((range) => range.end <= markdown.length)).toBe(
        true,
      );
    }
    expect(await service.split('  ')).toEqual([]);
  });

  it('keeps long cell fragments bounded and identifies their logical source', async () => {
    const chunks = await create(60, 0).splitStructured(
      '| Key | Value |\n| --- | --- |\n| A | ' + 'x'.repeat(80) + ' |',
    );
    expect(chunks.every((chunk) => chunk.content.length <= 60)).toBe(true);
    const values = chunks.filter(
      (chunk) => chunk.ranges[0].source?.tableColumn === 2,
    );
    expect(values.length).toBeGreaterThan(1);
    expect(values[0].ranges[0].source).toMatchObject({
      tableRowStart: 2,
      tableRowEnd: 2,
      tableCellStart: 0,
    });
    expect(values.at(-1)?.ranges[0].source?.tableCellEnd).toBe(80);
    await expect(
      create(32, 0).split('| ' + 'Long'.repeat(30) + ' |\n| --- |\n| A |'),
    ).rejects.toThrow('context');
  });

  it.each([
    [0, 0],
    [120, -1],
    [120, 120],
    [NaN, 0],
    [Infinity, 0],
    [120.5, 0],
  ])('rejects invalid budgets (%s, %s)', (size, overlap) => {
    expect(() => create(size, overlap)).toThrow();
  });

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
