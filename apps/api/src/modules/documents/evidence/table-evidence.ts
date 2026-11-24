import { DocumentBlock } from '../../ingestion/document-structure';
import { EvidenceUnit } from './evidence.types';

/** Bounded canonical anchor-cell groups; merged values are never expanded here. */
export function tableEvidence(
  block: DocumentBlock,
  producer: string,
): EvidenceUnit[] {
  const table = block.table;
  if (!table) return [];
  const units: EvidenceUnit[] = [];
  let cells: typeof table.cells = [],
    bytes = 0;
  const flush = () => {
    if (!cells.length) return;
    units.push({
      schema: 'evidence-v1',
      id: `${table.id}-${units.length}`,
      kind: 'table',
      source: {
        ...block.source,
        tableId: table.id,
        tableRowStart: cells[0].row,
        tableRowEnd: cells.at(-1)!.row,
      },
      objectKeys: [],
      text: table.caption ?? '',
      producer,
      data: { ...table, cells, start: block.start, end: block.end },
    });
    cells = [];
    bytes = 0;
  };
  for (const cell of table.cells) {
    const size = Buffer.byteLength(JSON.stringify(cell));
    if (size > 512 * 1024)
      throw new Error('Table cell exceeds evidence byte budget');
    if (cells.length && (bytes + size > 512 * 1024 || cells.length >= 1000))
      flush();
    cells.push(cell);
    bytes += size;
  }
  flush();
  return units;
}
