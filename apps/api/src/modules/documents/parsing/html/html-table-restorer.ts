import { DomUtils, parseDocument } from 'htmlparser2';
import { parseTable } from '../../../ingestion/tables/parse-table';
import { TableData } from '../../../ingestion/tables/table.types';
import { markdownBlocks } from '../../../ingestion/markdown-blocks';
import { ParsedDocument } from '../file-parser.types';

const signature = (table: TableData) =>
  JSON.stringify(
    table.cells.map((cell) =>
      cell.text.normalize('NFKC').replace(/\s+/gu, ' ').trim(),
    ),
  );
const shape = (table: TableData) =>
  JSON.stringify([
    table.rowCount,
    table.columnCount,
    table.headerRows,
    table.cells,
  ]);
const escape = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Render only canonical text and spans, never source scripts, styles or URLs. */
function render(table: TableData): string {
  let html = `<table>${table.caption ? `<caption>${escape(table.caption)}</caption>` : ''}`;
  let group = '';
  const rows = new Map<number, TableData['cells']>();
  for (const cell of table.cells) {
    const row = rows.get(cell.row) ?? [];
    row.push(cell);
    rows.set(cell.row, row);
  }
  const headers = new Set(table.headerRows);
  for (let row = 1; row <= table.rowCount; row++) {
    const next = headers.has(row) ? 'thead' : 'tbody';
    if (next !== group) {
      if (group) html += `</${group}>`;
      html += `<${next}>`;
      group = next;
    }
    html += '<tr>';
    for (const cell of rows.get(row) ?? []) {
      const tag = cell.header ? 'th' : 'td';
      html += `<${tag} rowspan="${cell.rowSpan}" colspan="${cell.columnSpan}"${cell.scope ? ` scope="${cell.scope}"` : ''}>${escape(cell.text).replace(/\n/g, '<br>')}</${tag}>`;
    }
    html += '</tr>';
  }
  return html + `</${group}></table>`;
}

/** Restore spans only when source and engine have one unique identical anchor-text sequence. */
export function restoreHtmlTables(
  result: ParsedDocument,
  sourceBytes: string | Buffer,
): void {
  let html: string;
  try {
    html =
      typeof sourceBytes === 'string'
        ? sourceBytes
        : new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
  } catch {
    review(result, 'Native HTML table verification requires valid UTF-8.');
    return;
  }
  if (Buffer.byteLength(html) > 4 * 1024 * 1024) {
    review(result, 'Native HTML table verification exceeds source budget.');
    return;
  }
  const root = parseDocument(html, { decodeEntities: true });
  if (root.children.length > 100000) {
    review(result, 'Native HTML table verification exceeds node budget.');
    return;
  }
  const source: TableData[] = [];
  const stack = [...root.children];
  let visited = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (++visited > 100000) {
      review(result, 'Native HTML table verification exceeds node budget.');
      return;
    }
    if ('name' in node) {
      if (['script', 'style', 'template'].includes(node.name)) continue;
      if (node.name === 'table') {
        if (source.length >= 256) {
          review(
            result,
            'Native HTML table verification exceeds table budget.',
          );
          return;
        }
        // Canonical text serialization cannot retain interactive links or embedded media.
        if (/<(?:a|img|video|audio)\b/i.test(DomUtils.getOuterHTML(node))) {
          review(
            result,
            'Source HTML table contains linked or embedded resources; retain engine output for review.',
          );
          continue;
        }
        try {
          source.push(parseTable(DomUtils.getOuterHTML(node)));
        } catch {
          review(result, 'Source HTML table needs manual structural review.');
        }
      } else if ('children' in node) {
        if (visited + stack.length + node.children.length > 100000) {
          review(result, 'Native HTML table verification exceeds node budget.');
          return;
        }
        for (const child of node.children) stack.push(child);
      }
    }
  }
  const blocks = markdownBlocks(result.markdown, result.sections).filter(
    (block) => block.table,
  );
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const table of source) {
    const key = signature(table);
    const candidates = blocks.filter(
      (block) => signature(block.table!) === key,
    );
    if (
      source.filter((table) => signature(table) === key).length !== 1 ||
      candidates.length !== 1
    ) {
      review(
        result,
        'Source HTML table cannot be uniquely matched to engine output.',
      );
      continue;
    }
    const block = candidates[0];
    if (shape(table) !== shape(block.table!))
      replacements.push({
        start: block.start,
        end: block.end,
        text: render(table),
      });
  }
  if (blocks.length !== source.length)
    review(result, 'Source and engine HTML table counts differ.');
  replacements.sort((a, b) => a.start - b.start);
  const offset = (position: number) =>
    position +
    replacements
      .filter((change) => change.end <= position)
      .reduce(
        (sum, change) => sum + change.text.length - (change.end - change.start),
        0,
      );
  if (!replacements.length) return;
  for (const section of result.sections || []) {
    section.start = offset(section.start);
    section.end = offset(section.end);
  }
  for (const evidence of result.evidence || []) {
    if (typeof evidence.data.markdownStart === 'number')
      evidence.data.markdownStart = offset(evidence.data.markdownStart);
    if (typeof evidence.data.markdownEnd === 'number')
      evidence.data.markdownEnd = offset(evidence.data.markdownEnd);
  }
  for (const change of [...replacements].reverse())
    result.markdown =
      result.markdown.slice(0, change.start) +
      change.text +
      result.markdown.slice(change.end);
  result.blocks = markdownBlocks(result.markdown, result.sections);
  result.parseStrategy = `${result.parseStrategy || 'mineru'}:html-native-v1`;
  result.provenance = {
    ...result.provenance,
    htmlTableStructure: 'native-source-v1',
  };
}
function review(result: ParsedDocument, message: string) {
  result.ready = false;
  result.quality = {
    status: 'needs_review',
    issues: [
      ...(result.quality?.issues || []),
      { code: 'HTML_TABLE_SOURCE_REVIEW', message },
    ],
  };
  result.warnings.push(message);
}
