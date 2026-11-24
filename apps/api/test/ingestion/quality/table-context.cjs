/** Check exact header order, full row value association and per-table source ranges. */
function line(values) {
  const escape = (value) =>
    String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ');
  return `| ${values.map(escape).join(' | ')} |`;
}
function tableContext(chunks, tableId, gold) {
  const header = line(gold.header);
  const missing = gold.rows
    .filter(
      (row) =>
        !chunks.some((chunk) => {
          const belongs = chunk.ranges.some(
            (range) =>
              range.source?.tableId === tableId &&
              range.source.tableRowStart <= row.row &&
              range.source.tableRowEnd >= row.row,
          );
          return (
            belongs &&
            chunk.content.split('\n').includes(header) &&
            chunk.content.split('\n').includes(line(row.values))
          );
        }),
    )
    .map((row) => row.row);
  return {
    expected: gold.rows.length,
    matched: gold.rows.length - missing.length,
    missing,
  };
}
module.exports = { tableContext };
