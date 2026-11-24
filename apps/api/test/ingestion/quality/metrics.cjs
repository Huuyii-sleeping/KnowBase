// Literal, reference-based checks. No model judge and no annotation enters inference.
function literal(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}
function factCoverage(text, facts = []) {
  const actual = literal(text);
  const contains = (value) => {
    const token = literal(value);
    if (!token) throw new Error('Fact aliases must be nonempty');
    for (
      let index = actual.indexOf(token);
      index >= 0;
      index = actual.indexOf(token, index + 1)
    ) {
      if (/^[\d+.-]/.test(token) && /[\d+.-]/.test(actual[index - 1] || ''))
        continue;
      if (
        /\d$/.test(token) &&
        /^(?:\d|\.\d)/.test(actual.slice(index + token.length))
      )
        continue;
      return true;
    }
    return false;
  };
  const missing = facts
    .map((aliases, index) => (aliases.some(contains) ? -1 : index))
    .filter((index) => index >= 0);
  return {
    expected: facts.length,
    matched: facts.length - missing.length,
    missing,
  };
}
function tableScore(actual, expected) {
  let matched = 0,
    total = 0,
    correctStructure = 0;
  expected.forEach((gold, index) => {
    const table = actual[index];
    if (
      table &&
      table.rowCount === gold.rowCount &&
      table.columnCount === gold.columnCount &&
      JSON.stringify(table.headerRows) === JSON.stringify(gold.headerRows)
    )
      correctStructure++;
    for (const [row, column, text, rowSpan = 1, columnSpan = 1] of gold.cells) {
      total++;
      const cell = table?.cells.find(
        (cell) => cell.row === row && cell.column === column,
      );
      if (
        cell &&
        literal(cell.text) === literal(text) &&
        cell.rowSpan === rowSpan &&
        cell.columnSpan === columnSpan
      )
        matched++;
    }
  });
  const actualCells = actual.reduce((n, table) => n + table.cells.length, 0);
  return {
    expectedTables: expected.length,
    actualTables: actual.length,
    correctStructure,
    expectedCells: total,
    actualCells,
    matchedCells: matched,
    recall: total ? matched / total : null,
    precision: actualCells ? matched / actualCells : total ? 0 : null,
  };
}
function scoreDocument(result, gold) {
  const facts = factCoverage(result.markdown, gold.facts);
  const tables = tableScore(
    (result.blocks || [])
      .filter((block) => block.table)
      .map((block) => block.table),
    gold.tables || [],
  );
  const rows = (result.evidence || []).filter(
    (unit) => unit.kind === 'worksheet_row',
  );
  const checks = (gold.worksheetCells || []).map(
    ({ sheet, address, ...expected }) => {
      const cell = rows
        .filter((row) => row.source.sheet === sheet)
        .flatMap((row) => row.data.cells)
        .find((cell) => cell.address === address);
      return (
        !!cell &&
        Object.entries(expected).every(
          ([key, value]) => JSON.stringify(cell[key]) === JSON.stringify(value),
        )
      );
    },
  );
  const missingIssues = (gold.requiredIssues || []).filter(
    (code) =>
      !(result.quality?.issues || []).some((issue) => issue.code === code),
  );
  const tablesPass =
    !gold.tables ||
    (tables.expectedTables === tables.actualTables &&
      tables.correctStructure === tables.expectedTables &&
      tables.matchedCells === tables.expectedCells &&
      tables.actualCells === tables.expectedCells);
  return {
    facts,
    ...(gold.tables ? { tables } : {}),
    nativeCells: {
      expected: checks.length,
      matched: checks.filter(Boolean).length,
    },
    missingIssues,
    passed:
      facts.missing.length === 0 &&
      tablesPass &&
      checks.every(Boolean) &&
      missingIssues.length === 0 &&
      result.quality?.status !== 'failed',
  };
}
module.exports = {
  factCoverage,
  tableScore,
  scoreDocument,
};
