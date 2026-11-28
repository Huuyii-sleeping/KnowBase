import { TableCell, TABLE_LIMITS } from './table.types';

// Backslash-escaped pipes are data, not column boundaries. Preserve backslashes
// for other escapes so a displayed value is not silently rewritten.
export function markdownCells(line: string): string[] {
  const text = line.trim();
  const values: string[] = [];
  let value = '';
  for (let i = text.startsWith('|') ? 1 : 0; i < text.length; i++) {
    // Consume pairs: an even run of backslashes leaves the pipe as a boundary.
    if (text[i] === '\\' && ['|', '\\'].includes(text[i + 1])) {
      value += text[++i];
    } else if (text[i] === '|') {
      values.push(value.trim());
      value = '';
      if (i === text.length - 1) return values;
    } else value += text[i];
  }
  values.push(value.trim());
  return values;
}

export function markdownTable(source: string) {
  const [first, delimiter, ...body] = source.trim().split(/\r?\n/);
  const header = markdownCells(first);
  const separators = markdownCells(delimiter || '');
  if (
    !separators.every((cell) => /^:?-{3,}:?$/.test(cell)) ||
    header.length !== separators.length
  )
    throw new Error('Invalid Markdown table header');
  const rows = [header, ...body.map(markdownCells)];
  if (
    rows.length > TABLE_LIMITS.maxRows ||
    header.length > TABLE_LIMITS.maxColumns ||
    rows.length * header.length > TABLE_LIMITS.maxSlots
  )
    throw new Error('Markdown table exceeds cell budget');
  if (rows.some((row) => row.length !== header.length))
    throw new Error('Inconsistent Markdown table columns; review the source');
  const cells: TableCell[] = rows.flatMap((row, r) =>
    row.map((text, c) => ({
      row: r + 1,
      column: c + 1,
      rowSpan: 1,
      columnSpan: 1,
      text,
      header: r === 0,
    })),
  );
  return {
    rowCount: rows.length,
    columnCount: header.length,
    headerRows: [1],
    cells,
  };
}
