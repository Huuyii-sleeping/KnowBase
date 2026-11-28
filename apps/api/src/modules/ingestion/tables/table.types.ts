import { SourceLocation } from '../document-structure';

// Coordinates are one-based within this table, not Excel addresses or PDF pixels.
export interface TableCell {
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  text: string;
  header: boolean;
  scope?: 'row' | 'col' | 'rowgroup' | 'colgroup';
}

export interface TableData {
  schema: 'table-v1';
  id: string;
  format: 'html' | 'markdown';
  rowCount: number;
  columnCount: number;
  headerRows: number[];
  cells: TableCell[];
  caption?: string;
}

export interface TableEvidence extends TableData {
  start: number;
  end: number;
  source?: SourceLocation;
}

export const TABLE_LIMITS = {
  maxCharacters: 4194304,
  maxRows: 10000,
  maxColumns: 256,
  maxSlots: 100000,
};
