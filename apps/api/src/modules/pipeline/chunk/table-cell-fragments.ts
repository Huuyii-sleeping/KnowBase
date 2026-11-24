import { TableData } from '../../ingestion/tables/table.types';
import { tableGrid, tableSearchView } from '../../ingestion/tables/table-view';

export interface TableFragment {
  text: string;
  rowStart: number;
  rowEnd: number;
  column?: number;
  cellStart?: number;
  cellEnd?: number;
}

/** Offsets describe the visible canonical cell text, before Markdown escaping. */
function textParts(text: string, budget: number) {
  if (budget < 1) throw new Error('Table cell context exceeds RAG_CHUNK_SIZE.');
  const parts: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  do {
    let end = Math.min(text.length, start + budget);
    if (end < text.length) {
      // Never split a UTF-16 surrogate pair; prefer complete sentences/lines.
      if (/[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
      const window = text.slice(start, end);
      const boundaries = [
        ...window.matchAll(/[。！？；\n]|[.!?;](?=\s)|\s+/gu),
      ];
      const boundary = boundaries.at(-1);
      if (boundary && boundary.index! + boundary[0].length >= window.length / 2)
        end = start + boundary.index! + boundary[0].length;
    }
    if (end === start && text.length)
      throw new Error('Table cell character exceeds RAG_CHUNK_SIZE.');
    parts.push({ text: text.slice(start, end), start, end });
    start = end;
  } while (start < text.length);
  return parts;
}

/** Bounded fallback, explicitly cell fragments rather than complete table rows. */
export function tableCellFragments(
  table: TableData,
  budget: number,
  view: ReturnType<typeof tableSearchView>,
): TableFragment[] {
  const grid = tableGrid(table);
  return view.rows.flatMap(({ row }) =>
    view.headers.flatMap((header, index) => {
      const column = index + 1;
      const label = grid[row - 1][0]?.text || '';
      const context =
        index > 0 && label && label.length <= Math.floor(budget / 4)
          ? `行标识：${label}\n`
          : '';
      const prefix = `${table.caption ? table.caption + '\n' : ''}表内行 ${row}，列 ${column}\n${context}${header}：\n`;
      return textParts(
        grid[row - 1][index]?.text || '',
        budget - prefix.length,
      ).map((part) => ({
        text: prefix + part.text,
        rowStart: row,
        rowEnd: row,
        column,
        cellStart: part.start,
        cellEnd: part.end,
      }));
    }),
  );
}
