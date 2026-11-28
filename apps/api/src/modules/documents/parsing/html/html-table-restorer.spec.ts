import { describe, expect, it } from 'vitest';
import { restoreHtmlTables } from './html-table-restorer';
import { markdownBlocks } from '../../../ingestion/markdown-blocks';
import { ParsedDocument } from '../file-parser.types';
const native =
  '<table><thead><tr><th>仓库</th><th>结果</th></tr></thead><tbody><tr><td rowspan="0">杭州</td><td>通过</td></tr><tr><td>复检</td></tr></tbody></table>';
const stripped = native.replace(' rowspan="0"', '');
function parsed(table = stripped): ParsedDocument {
  const markdown = `# 标题\n\n${table}\n\n后续正文\n`;
  const start = markdown.indexOf('<table>'),
    end = markdown.indexOf('</table>') + 8;
  return {
    markdown,
    parser: 'mineru',
    ready: true,
    warnings: [],
    assets: [],
    sections: [
      { start, end, source: { partition: 1, blockIndex: 1 } },
      {
        start: end + 2,
        end: markdown.length,
        source: { partition: 1, blockIndex: 2 },
      },
    ],
    evidence: [
      {
        schema: 'evidence-v1',
        id: 'image',
        kind: 'image',
        source: {},
        objectKeys: [],
        text: '图',
        producer: 'test',
        data: { markdownStart: end + 2, markdownEnd: markdown.length },
      },
    ],
  };
}
describe('source HTML table restoration', () => {
  it('restores lost spans with exact unique anchor text and relocates subsequent sources', () => {
    const result = parsed();
    restoreHtmlTables(result, native);
    const blocks = markdownBlocks(result.markdown, result.sections);
    const table = blocks.find((block) => block.table)!.table!;
    expect(table.cells.find((cell) => cell.text === '杭州')).toMatchObject({
      row: 2,
      column: 1,
      rowSpan: 2,
    });
    expect(table.cells.find((cell) => cell.text === '复检')).toMatchObject({
      row: 3,
      column: 2,
    });
    expect(result.markdown.slice(result.sections![1].start)).toBe('后续正文\n');
    expect(result.evidence![0].data.markdownStart).toBe(
      result.sections![1].start,
    );
    expect(result.ready).toBe(true);
    expect(result.provenance?.htmlTableStructure).toBe('native-source-v1');
  });
  it('keeps already correct structure stable', () => {
    const correct = native.replace('rowspan="0"', 'rowspan="2"');
    const result = parsed(correct),
      original = result.markdown;
    restoreHtmlTables(result, correct);
    expect(result.markdown).toBe(original);
    expect(result.ready).toBe(true);
  });
  it('never swaps unequal values or ambiguously matching tables', () => {
    const result = parsed();
    const before = result.markdown;
    restoreHtmlTables(result, native.replace('复检', '未通过'));
    expect(result.markdown).toBe(before);
    expect(result.ready).toBe(false);
    expect(result.quality!.issues[0].code).toBe('HTML_TABLE_SOURCE_REVIEW');
    const duplicate = parsed();
    restoreHtmlTables(duplicate, native + native);
    expect(duplicate.markdown).toBe(before);
    expect(duplicate.ready).toBe(false);
  });
  it('escapes source text and strips executable attributes during restoration', () => {
    const source = native.replace(
      '>杭州<',
      ' onclick="alert(1)">&lt;杭州&gt;<',
    );
    const result = parsed(source.replace(' rowspan="0"', ''));
    restoreHtmlTables(result, source);
    expect(result.markdown).toContain('&lt;杭州&gt;');
    expect(result.markdown).not.toContain('onclick');
    expect(result.ready).toBe(true);
  });
  it('retains unsupported source for review and bounds source parsing', () => {
    const result = parsed();
    restoreHtmlTables(
      result,
      '<table><tr><td><table><tr><td>nested</td></tr></table></td></tr></table>',
    );
    expect(result.ready).toBe(false);
    const huge = parsed();
    restoreHtmlTables(huge, 'x'.repeat(4 * 1024 * 1024 + 1));
    expect(huge.ready).toBe(false);
  });
  it('does not replace linked media or reinterpret invalid encodings', () => {
    const linked = parsed();
    const original = linked.markdown;
    restoreHtmlTables(
      linked,
      native.replace('杭州', '<a href="https://example.com">杭州</a>'),
    );
    expect(linked.markdown).toBe(original);
    expect(linked.ready).toBe(false);
    const invalid = parsed();
    restoreHtmlTables(invalid, Buffer.from([0xff, 0xfe, 0x81]));
    expect(invalid.ready).toBe(false);
    expect(invalid.markdown).toBe(original);
  });
});
