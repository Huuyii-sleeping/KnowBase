import { TableData } from '../../ingestion/tables/table.types';
import { tableSearchView } from '../../ingestion/tables/table-view';
import { tableCellFragments, TableFragment } from './table-cell-fragments';

export function structuredTableFragments(
  table: TableData,
  budget: number,
): TableFragment[] {
  if (!Number.isSafeInteger(budget) || budget < 1)
    throw new Error('Invalid table chunk budget');
  const view = tableSearchView(table);
  if (
    view.rows.length &&
    (view.header.length > budget ||
      view.rows.some(
        (row) => view.header.length + row.text.length + 1 > budget,
      ))
  )
    return tableCellFragments(table, budget, view);
  if (view.header.length > budget)
    throw new Error('Table header exceeds RAG_CHUNK_SIZE.');
  const output: Array<{ text: string; rowStart: number; rowEnd: number }> = [];
  let text = view.header;
  let rowStart = 0;
  let rowEnd = 0;
  const flush = () => {
    if (!rowStart) return;
    output.push({ text, rowStart, rowEnd });
    text = view.header;
    rowStart = 0;
  };
  for (const row of view.rows) {
    if (text.length + row.text.length + 1 > budget) flush();
    if (!rowStart) rowStart = row.row;
    rowEnd = row.row;
    text += '\n' + row.text;
  }
  flush();
  if (!output.length)
    output.push({ text: view.header, rowStart: 1, rowEnd: table.rowCount });
  return output;
}
