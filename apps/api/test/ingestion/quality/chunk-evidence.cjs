const { factCoverage } = require('./metrics.cjs');
const { digest } = require('./corpus.cjs');
const includes = (text, quote) => factCoverage(text, [[quote]]).matched === 1;
function rowRange(chunk, block, row) {
  return chunk.ranges.filter(
    (range) =>
      range.start === block.start &&
      range.end === block.end &&
      range.source?.tableId === block.table.id &&
      range.source.tableRowStart <= row &&
      range.source.tableRowEnd >= row,
  );
}
function cellParts(chunk, block, row, column, grid, view) {
  const value = grid[row - 1][column - 1]?.text || '';
  return rowRange(chunk, block, row).flatMap((range) => {
    const source = range.source;
    if (source.tableColumn === undefined) {
      const fullRow = view.rows.find((item) => item.row === row)?.text;
      return fullRow &&
        chunk.content.includes(view.header) &&
        chunk.content.includes(fullRow)
        ? [{ start: 0, end: value.length }]
        : [];
    }
    const start = source.tableCellStart,
      end = source.tableCellEnd;
    return source.tableColumn === column &&
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end >= start &&
      end <= value.length &&
      chunk.content.includes(view.headers[column - 1]) &&
      chunk.content.endsWith(value.slice(start, end))
      ? [{ start, end }]
      : [];
  });
}
function covers(parts, length) {
  let end = 0;
  if (!parts.length) return false;
  for (const part of [...parts].sort((a, b) => a.start - b.start)) {
    if (part.start > end) return false;
    end = Math.max(end, part.end);
  }
  return end === length;
}
/** Gold annotations enter only this scorer, never parsing or splitting. */
function scoreChunks(markdown, blocks, chunks, units, tables) {
  const tableBlocks = blocks.filter((block) => block.table);
  const views = tableBlocks.map((block) => ({
    grid: tables.tableGrid(block.table),
    view: tables.tableSearchView(block.table),
  }));
  const evidence = units.map((unit) => {
    const block =
      unit.table === undefined ? undefined : tableBlocks[unit.table];
    const entry = unit.table === undefined ? undefined : views[unit.table];
    if (
      unit.table !== undefined &&
      (!Number.isInteger(unit.table) ||
        unit.table < 0 ||
        !block ||
        !Number.isInteger(unit.row) ||
        unit.row < 1 ||
        unit.row > block.table.rowCount ||
        block.table.headerRows.includes(unit.row) ||
        !Number.isInteger(unit.column) ||
        unit.column < 1 ||
        unit.column > block.table.columnCount)
    )
      throw new Error(`Invalid annotated table cell: ${unit.id}`);
    const original = block
      ? (entry?.grid[unit.row - 1]?.[unit.column - 1]?.text ?? '')
      : markdown;
    if (unit.quotes.some((quote) => !includes(original, quote)))
      throw new Error(`Missing annotated source quote: ${unit.id}`);
    const located = chunks.filter(
      (chunk) =>
        chunk.headingPath.includes(unit.heading) &&
        (block
          ? cellParts(
              chunk,
              block,
              unit.row,
              unit.column,
              entry.grid,
              entry.view,
            ).length > 0
          : chunk.ranges.some((range) =>
              blocks.some(
                (b) =>
                  b.kind !== 'heading' &&
                  b.start === range.start &&
                  b.end === range.end &&
                  b.headingPath.includes(unit.heading),
              ),
            )),
    );
    const preserved = unit.quotes.filter((quote) =>
      chunks.some((chunk) => includes(chunk.content, quote)),
    ).length;
    const quoteLocated = (chunk, quote) =>
      includes(chunk.content, quote) &&
      (block
        ? cellParts(
            chunk,
            block,
            unit.row,
            unit.column,
            entry.grid,
            entry.view,
          ).some((part) =>
            includes(original.slice(part.start, part.end), quote),
          )
        : chunk.ranges.some((range) =>
            blocks.some(
              (b) =>
                b.kind !== 'heading' &&
                b.start === range.start &&
                b.end === range.end &&
                b.headingPath.includes(unit.heading) &&
                includes(b.text, quote),
            ),
          ));
    const sourceMatched = unit.quotes.every((quote) =>
      located.some((chunk) => quoteLocated(chunk, quote)),
    );
    const together = located.some((chunk) =>
      unit.quotes.every((quote) => quoteLocated(chunk, quote)),
    );
    return {
      id: unit.id,
      quotes: unit.quotes.length,
      preserved,
      sourceMatched,
      together,
    };
  });
  let slots = 0,
    covered = 0;
  tableBlocks.forEach((block, index) => {
    const { grid, view } = views[index];
    for (const row of view.rows)
      for (let column = 1; column <= block.table.columnCount; column++) {
        slots++;
        const parts = chunks.flatMap((chunk) =>
          cellParts(chunk, block, row.row, column, grid, view),
        );
        if (covers(parts, (grid[row.row - 1][column - 1]?.text || '').length))
          covered++;
      }
  });
  const lengths = chunks
    .map((chunk) => chunk.content.length)
    .sort((a, b) => a - b);
  const seen = new Set();
  let identicalChunkCharacters = 0;
  for (const chunk of chunks) {
    const hash = digest(chunk.content);
    if (seen.has(hash)) identicalChunkCharacters += chunk.content.length;
    seen.add(hash);
  }
  return {
    evidence,
    cells: { expected: slots, covered },
    expectedQuotes: evidence.reduce((sum, unit) => sum + unit.quotes, 0),
    preservedQuotes: evidence.reduce((sum, unit) => sum + unit.preserved, 0),
    together: evidence.filter((unit) => unit.together).length,
    sourceMatched: evidence.filter((unit) => unit.sourceMatched).length,
    chunks: chunks.length,
    indexedCharacters: lengths.reduce((a, b) => a + b, 0),
    identicalChunkCharacters,
    lengths: {
      p50: lengths[Math.floor(lengths.length * 0.5)] || 0,
      p95:
        lengths[
          Math.min(lengths.length - 1, Math.floor(lengths.length * 0.95))
        ] || 0,
      max: lengths.at(-1) || 0,
    },
    passed:
      evidence.every(
        (unit) =>
          unit.together && unit.sourceMatched && unit.preserved === unit.quotes,
      ) && covered === slots,
  };
}
module.exports = { covers, scoreChunks };
