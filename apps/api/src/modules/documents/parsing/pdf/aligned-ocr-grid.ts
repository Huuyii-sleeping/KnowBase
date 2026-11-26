import { TABLE_LIMITS } from '../../../ingestion/tables/table.types';

interface Token {
  text: string;
  start: number;
  end: number;
}
export interface AlignedOcrGrid {
  rows: string[][];
  caption?: string;
}
const tokens = (line: string): Token[] =>
  [...line.matchAll(/\S+(?: \S+)*/gu)].map((match) => ({
    text: match[0],
    start: match.index!,
    end: match.index! + match[0].length,
  }));

/** Infer candidate cells only from consistent OCR text anchors, never values or business labels. */
export function alignedOcrGrid(content: string): AlignedOcrGrid | undefined {
  if (content.length > TABLE_LIMITS.maxCharacters) return;
  const fenced = content
    .replace(/\r\n/g, '\n')
    .match(/^```\s*\n([\s\S]*?)\n```$/u);
  if (!fenced) return;
  const lines = fenced[1].split('\n');
  if (
    lines.length < 2 ||
    lines.length > TABLE_LIMITS.maxRows ||
    lines.some((line) => !line.trim() || /[\t|<>`\[\]]/u.test(line))
  )
    return;
  let caption: string | undefined;
  if (tokens(lines[0]).length === 1) {
    // A standalone title is a caption candidate, never evidence of a merged cell.
    caption = lines.shift()!.trim();
    if (/^[-+]?\d/u.test(caption)) return;
  }
  const header = tokens(lines[0] ?? '');
  if (
    header.length < 2 ||
    header.length > TABLE_LIMITS.maxColumns ||
    lines.length < 2 ||
    lines.length * header.length > TABLE_LIMITS.maxSlots
  )
    return;
  // Leave a unique ±1-character anchor window for every column.
  if (header.some((cell, i) => i > 0 && cell.start - header[i - 1].start < 4))
    return;
  const rows: string[][] = [header.map((cell) => cell.text)];
  let complete = 0,
    missing = false;
  for (const line of lines.slice(1)) {
    const row = Array<string>(header.length).fill('');
    for (const token of tokens(line)) {
      const column = header.findIndex(
        (cell) => Math.abs(cell.start - token.start) <= 1,
      );
      if (
        column < 0 ||
        row[column] ||
        (column < header.length - 1 && token.end > header[column + 1].start - 1)
      )
        return;
      row[column] = token.text;
    }
    // An unlabeled sparse row could be a wrapped cell or continuation, not a new record.
    if (!row[0]) return;
    if (row.every(Boolean)) complete++;
    else missing = true;
    rows.push(row);
  }
  // Sparse rows require two complete data rows to corroborate the column anchors.
  if ((missing || caption) && complete < 2) return;
  return { rows, ...(caption ? { caption } : {}) };
}
