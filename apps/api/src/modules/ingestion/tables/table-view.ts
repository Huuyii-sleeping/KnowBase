import { TableCell, TableData } from './table.types';

// A derived search view: spanning cells are repeated for context, while the
// canonical cells preserve their one original value and span for calculations.
export function tableGrid(
  table: TableData,
): Array<Array<TableCell | undefined>> {
  const grid: Array<Array<TableCell | undefined>> = Array.from(
    { length: table.rowCount },
    () => Array(table.columnCount),
  );
  for (const cell of table.cells)
    for (let r = cell.row - 1; r < cell.row - 1 + cell.rowSpan; r++)
      for (let c = cell.column - 1; c < cell.column - 1 + cell.columnSpan; c++)
        grid[r][c] = cell;
  return grid;
}

export function tableSearchView(table: TableData) {
  const grid = tableGrid(table);
  const headerSet = new Set(table.headerRows);
  const headers = Array.from({ length: table.columnCount }, (_, column) => {
    const seen = new Set<TableCell>();
    const labels: string[] = [];
    for (const row of table.headerRows) {
      const cell = grid[row - 1][column];
      if (cell && !seen.has(cell) && cell.text) {
        labels.push(cell.text);
        seen.add(cell);
      }
    }
    return labels.join(' / ') || `列 ${column + 1}`;
  });
  const escape = (text: string) =>
    text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const line = (values: string[]) => `| ${values.map(escape).join(' | ')} |`;
  return {
    header: `${table.caption ? escape(table.caption) + '\n\n' : ''}${line(headers)}\n${line(headers.map(() => '---'))}`,
    rows: grid.flatMap((cells, index) =>
      headerSet.has(index + 1)
        ? []
        : [
            {
              row: index + 1,
              text: line(cells.map((cell) => cell?.text || '')),
            },
          ],
    ),
  };
}
