import { describe, expect, it } from 'vitest';
import { parseTable } from '../../ingestion/tables/parse-table';
import { tableEvidence } from './table-evidence';
describe('canonical table evidence shards', () => {
  it('preserves every canonical anchor exactly once across bounded shards', () => {
    const table = parseTable(
      '| Label | Value |\n| --- | --- |\n' +
        Array.from({ length: 1200 }, (_, i) => `| R${i} | ${i} |`).join('\n'),
    );
    const block = {
      kind: 'table' as const,
      text: '',
      start: 0,
      end: 10,
      headingPath: [],
      source: { page: 3 },
      table,
    };
    const units = tableEvidence(block, 'test');
    expect(units.length).toBeGreaterThan(1);
    expect(units.flatMap((unit) => unit.data.cells)).toEqual(table.cells);
    expect(
      units.every(
        (unit) => unit.source.page === 3 && unit.source.tableId === table.id,
      ),
    ).toBe(true);
    expect(new Set(units.map((unit) => unit.id)).size).toBe(units.length);
  });
});
