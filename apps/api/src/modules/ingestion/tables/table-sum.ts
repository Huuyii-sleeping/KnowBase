import { TableData } from './table.types';

export interface TableCellReference {
  row: number;
  column: number;
}

function decimal(text: string) {
  // Explicit values only. Units, percentages, blanks and expressions need a
  // caller-supplied interpretation; never coerce them to zero or evaluate them.
  const match = /^([+-]?)(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/.exec(
    text.trim(),
  );
  if (!match) throw new Error('Table cell is not an unambiguous decimal value');
  const digits = match[2].replaceAll(',', '');
  const fraction = match[3] || '';
  if (digits.length > 100 || fraction.length > 18)
    throw new Error('Table numeric precision exceeds budget');
  return {
    value: BigInt(`${match[1] === '-' ? '-' : ''}${digits}${fraction}`),
    scale: fraction.length,
  };
}

/** Deterministic sum over explicit canonical cells; no model calls or SQL execution. */
export function sumTableCells(
  table: TableData,
  references: TableCellReference[],
) {
  if (!references.length || references.length > table.cells.length)
    throw new Error('Select a nonempty bounded set of table cells');
  const anchors = new Map(
    table.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]),
  );
  const headerRows = new Set(table.headerRows);
  const selected = new Set<string>();
  const values = references.map((reference) => {
    if (
      !Number.isSafeInteger(reference.row) ||
      !Number.isSafeInteger(reference.column)
    )
      throw new Error('Invalid table cell coordinates');
    const cell = anchors.get(`${reference.row}:${reference.column}`);
    if (!cell || cell.header || headerRows.has(cell.row))
      throw new Error(
        'Select an original data cell, not a covered merge position or header',
      );
    const key = `${cell.row}:${cell.column}`;
    if (selected.has(key)) throw new Error('Duplicate canonical table cell');
    selected.add(key);
    return decimal(cell.text);
  });
  const scale = values.reduce(
    (maximum, value) => Math.max(maximum, value.scale),
    0,
  );
  const total = values.reduce(
    (sum, value) => sum + value.value * 10n ** BigInt(scale - value.scale),
    0n,
  );
  const digits = (total < 0n ? -total : total)
    .toString()
    .padStart(scale + 1, '0');
  const result = `${total < 0n ? '-' : ''}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
  return {
    tableId: table.id,
    operation: 'sum' as const,
    value: result,
    cells: references.map((reference) => ({ ...reference })),
  };
}
