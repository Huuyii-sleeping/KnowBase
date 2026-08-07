import { escapeTableCell } from './parser.utils';

export function tableToMarkdown(rows: string[][]): string {
  if (!rows.length) {
    return '';
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => escapeTableCell(row[index] ?? '')),
  );
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(3, ...normalized.map((row) => Array.from(row[column]).length)),
  );
  const formatRow = (row: string[]) =>
    `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(' | ')} |`;

  return [
    formatRow(normalized[0]),
    formatRow(widths.map((width) => '-'.repeat(width))),
    ...normalized.slice(1).map(formatRow),
  ].join('\n');
}
