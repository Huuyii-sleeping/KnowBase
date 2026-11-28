const { tableScore } = require('../quality/metrics.cjs');
// Additional metric: header/body coordinates only. It never certifies a title's merged-cell topology.
function tableBodyAudit(result, references) {
  return references.map((reference) => {
    if (!reference.headerRows.length)
      throw new Error('Audit needs an explicit header row');
    const offset = reference.headerRows.at(-1) - 1;
    if (
      reference.headerRows.some((row, i) => row !== i + 1) &&
      reference.headerRows.length !== 1
    )
      throw new Error('Audit needs contiguous header rows');
    const titles = reference.cells.filter((cell) => cell[0] <= offset);
    if (
      offset &&
      (titles.length !== offset ||
        titles.some(
          (cell) =>
            cell[1] !== 1 ||
            (cell[3] || 1) !== 1 ||
            cell[4] !== reference.columnCount,
        ))
    )
      throw new Error('Audit cannot discard ambiguous leading cells');
    const projected = {
      ...reference,
      rowCount: reference.rowCount - offset,
      headerRows: [1],
      cells: reference.cells
        .filter((cell) => cell[0] > offset)
        .map(([r, ...cell]) => [r - offset, ...cell]),
    };
    const tables = (result.blocks || [])
      .filter((block) => block.table && block.source?.page === reference.page)
      .map((x) => x.table);
    const normalize = (text) =>
      String(text).normalize('NFKC').replace(/\s+/gu, '');
    return {
      page: reference.page,
      ...tableScore(tables, [projected]),
      titleExpected: titles.length ? 1 : 0,
      titleMatched:
        titles.length &&
        tables.some(
          (table) =>
            normalize(table.caption || '') ===
            normalize(titles.map((cell) => cell[2]).join(' ')),
        )
          ? 1
          : 0,
      mergedTitleTopology: offset ? 'not_verified' : 'not_applicable',
    };
  });
}
module.exports = { tableBodyAudit };
