import { tableToMarkdown } from '../markdown-table.util';

export function renderPdfText(
  items: Array<{
    str?: string;
    transform?: number[];
    width?: number;
    hasEOL?: boolean;
  }>,
): string {
  let output = '';
  let previousY: number | undefined;
  let previousEnd: number | undefined;
  for (const item of items) {
    const value = item.str?.trim();
    if (!value) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? previousY ?? 0;
    if (previousY !== undefined && !output.endsWith('\n')) {
      output +=
        Math.abs(y - previousY) > 2
          ? '\n'
          : previousEnd !== undefined && x - previousEnd > 36
            ? '\t'
            : ' ';
    }
    output += value + (item.hasEOL ? '\n' : '');
    previousEnd = x + (item.width ?? value.length * 5);
    previousY = y;
  }
  return output.trim();
}

/** Only contiguous table rows are grouped, preserving text before and after them. */
export function pdfPageMarkdown(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const output: string[] = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].includes('\t')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('\t'))
        rows.push(lines[i++].split('\t').map((cell) => cell.trim()));
      // A lone row may still contain facts. Never drop it for lacking a header.
      output.push(rows.length > 1 ? tableToMarkdown(rows) : rows[0].join(' '));
    } else {
      output.push(lines[i++]);
    }
  }
  return output.join('\n\n');
}
