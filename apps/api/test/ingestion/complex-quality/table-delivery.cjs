const assert = require('node:assert/strict');
const {
  tableSearchView,
} = require('../../../dist/src/modules/ingestion/tables/table-view.js');
const {
  markdownBlocks,
} = require('../../../dist/src/modules/ingestion/markdown-blocks.js');
function assertTablesPreserved(input, stored) {
  const expected = markdownBlocks(input.markdown, input.sections).filter(
    (x) => x.table,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(stored.tables || [])),
    JSON.parse(
      JSON.stringify(
        expected.map((block) => ({
          ...block.table,
          start: block.start,
          end: block.end,
          source: block.source,
        })),
      ),
    ),
  );
}
function tableChunkDelivery(stored, chunks) {
  return (stored.tables || []).map((table) => {
    const view = tableSearchView(table);
    let matched = 0;
    for (const row of view.rows) {
      if (
        chunks.some(
          (chunk) =>
            chunk.content.includes(view.header) &&
            chunk.content.includes(row.text) &&
            chunk.ranges.some(
              (range) =>
                range.source?.tableId === table.id &&
                range.source.tableRowStart <= row.row &&
                range.source.tableRowEnd >= row.row &&
                Object.entries(table.source || {}).every(
                  ([key, value]) =>
                    JSON.stringify(range.source[key]) === JSON.stringify(value),
                ),
            ),
        )
      )
        matched++;
    }
    return { expectedRows: view.rows.length, matchedRows: matched };
  });
}
module.exports = { assertTablesPreserved, tableChunkDelivery };
