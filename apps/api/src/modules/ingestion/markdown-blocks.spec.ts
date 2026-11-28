import { describe, expect, it } from 'vitest';
import { markdownBlocks } from './markdown-blocks';

describe('Markdown structure', () => {
  it('keeps HTML tables atomic, preserves adjacent prose and ignores table markup inside code', () => {
    const table = '<table><tr><th>A</th></tr><tr><td>1</td></tr></table>';
    const input =
      '# Table\n\n前文。\n' + table + '后文。\n\n```html\n' + table + '\n```';
    const blocks = markdownBlocks(input);
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'table',
      'paragraph',
      'code',
    ]);
    expect(blocks[2]).toMatchObject({
      text: table,
      table: { columnCount: 1, rowCount: 2 },
    });
    expect(blocks[3].text).toBe('后文。');
    for (const block of blocks)
      expect(input.slice(block.start, block.end)).toBe(block.text);
  });

  it('rejects unclosed HTML tables and tables crossing explicit source partitions', () => {
    expect(() => markdownBlocks('<table><tr><td>x')).toThrow('Unclosed');
    const table = '<table>\n<tr><td>x</td></tr>\n</table>';
    expect(() =>
      markdownBlocks(table, [{ start: 0, end: 8, source: { page: 1 } }]),
    ).toThrow('crosses');
  });
  it('keeps display equations atomic and retains headings across source blocks on one page', () => {
    const text = '# Math\n\n$$\nx^2=1\n$$\n';
    const split = text.indexOf('$$');
    const blocks = markdownBlocks(text, [
      { start: 0, end: split, source: { page: 1, blockIndex: 0 } },
      { start: split, end: text.length, source: { page: 1, blockIndex: 1 } },
    ]);
    expect(blocks[1]).toMatchObject({
      kind: 'equation',
      headingPath: ['Math'],
      text: '$$\nx^2=1\n$$',
    });
  });
  it('recognizes a one-column table and preserves literal hashes in heading names', () => {
    const blocks = markdownBlocks(
      '# C#\n\n## Notes ##\n\n| 项目 |\n| --- |\n| A |',
    );
    expect(blocks.at(-1)).toMatchObject({
      kind: 'table',
      headingPath: ['C#', 'Notes'],
    });
  });

  it('keeps headings inside code literal and records exact source blocks', () => {
    const input =
      '# 指南\n\n## 发布\n\n正文。\n\n```ts\n# literal\n```\n\n| 名称 | 值 |\n| --- | --- |\n| A | 1 |';
    const blocks = markdownBlocks(input);
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'heading',
      'paragraph',
      'code',
      'table',
    ]);
    expect(blocks.at(-1)?.headingPath).toEqual(['指南', '发布']);
    for (const block of blocks)
      expect(input.slice(block.start, block.end)).toBe(block.text);
  });

  it('uses explicit source boundaries without inferring a page from user text', () => {
    const input = '## Page 1\n\nbody\n\n## Page 2\n\nnext';
    const split = input.indexOf('## Page 2');
    const blocks = markdownBlocks(input, [
      { start: 0, end: split, source: { page: 1 } },
      { start: split, end: input.length, source: { page: 2 } },
    ]);
    expect(blocks.at(-1)).toMatchObject({
      headingPath: ['Page 2'],
      source: { page: 2 },
    });
    expect(markdownBlocks(input)[1].source).toBeUndefined();
  });

  it('rejects an HTML table starting outside and crossing into a source section', () => {
    const input = '<table>\n<tr><td>x</td></tr>\n</table>';
    expect(() =>
      markdownBlocks(input, [
        { start: 8, end: input.length, source: { page: 2 } },
      ]),
    ).toThrow('crosses');
  });

  it('does not terminate tables at closing-tag text inside comments, attributes or scripts', () => {
    const source =
      '<table data-note="</table>"><tr><td><!-- </table> -->值<script>const x = "</table>";</script></td></tr><tr><td>后行</td></tr></table>后文';
    const blocks = markdownBlocks(source);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].table?.cells.map((cell) => cell.text)).toEqual([
      '值',
      '后行',
    ]);
    expect(blocks[1].text).toBe('后文');
    expect(source.slice(blocks[0].start, blocks[0].end)).toBe(blocks[0].text);
    expect(() => markdownBlocks('<table><tr><td>no close')).toThrow('Unclosed');
  });

  it.each([
    [{ start: -1, end: 1, source: {} }],
    [{ start: 0, end: 20, source: {} }],
    [
      { start: 0, end: 2, source: {} },
      { start: 1, end: 3, source: {} },
    ],
  ])('rejects invalid location ranges', (...sections) => {
    expect(() => markdownBlocks('abc', sections)).toThrow('source section');
  });

  it('retains Setext headings and CRLF source offsets without reading fenced examples or crossing partitions', () => {
    const text =
      'Policy\r\n====\r\n\r\nWindow\r\n---\r\nLimit 731.\r\n\r\n```md\r\nFake\r\n====\r\n```';
    const blocks = markdownBlocks(text);
    expect(blocks[2]).toMatchObject({
      kind: 'paragraph',
      text: 'Limit 731.',
      headingPath: ['Policy', 'Window'],
    });
    expect(blocks.at(-1)).toMatchObject({
      kind: 'code',
      headingPath: ['Policy', 'Window'],
    });
    for (const block of blocks)
      expect(text.slice(block.start, block.end)).toBe(block.text);
    const separated = 'Title\n====\nbody';
    expect(
      markdownBlocks(separated, [
        { start: 0, end: 6, source: { page: 1 } },
        { start: 6, end: separated.length, source: { page: 2 } },
      ]).some((block) => block.kind === 'heading'),
    ).toBe(false);
    expect(
      markdownBlocks('---\n\n> quoted\n---').some(
        (block) => block.kind === 'heading',
      ),
    ).toBe(false);
  });
  it('supports lists, tilde fences and empty content', () => {
    expect(markdownBlocks('')).toEqual([]);
    expect(
      markdownBlocks('- A\n- B\n\n~~~js\n## not a heading\n~~~').map(
        (block) => block.kind,
      ),
    ).toEqual(['list', 'code']);
  });
});
