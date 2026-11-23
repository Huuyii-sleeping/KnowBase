import { TableData } from '../../ingestion/tables/table.types';
import { tableSearchView } from '../../ingestion/tables/table-view';

export function structuredTableFragments(table: TableData, budget: number) {
  const view = tableSearchView(table);
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
    if (view.header.length + row.text.length + 1 > budget)
      throw new Error(
        'Table header and row exceed RAG_CHUNK_SIZE; increase the budget or simplify the source table.',
      );
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
