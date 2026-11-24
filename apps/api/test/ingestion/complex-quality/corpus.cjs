const path = require('node:path');
const { readFile, realpath } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const categories = [
  'flowchart',
  'chart',
  'screenshot',
  'scanned-table',
  'cross-page-table',
  'multicolumn',
  'formula-image',
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nonempty = (value) =>
  typeof value === 'string' && value.trim().length > 0;
function checks(value) {
  return (
    Array.isArray(value) &&
    new Set(value.map((x) => x.id)).size === value.length &&
    value.every(
      (x) =>
        nonempty(x.id) &&
        Array.isArray(x.aliases) &&
        x.aliases.length > 0 &&
        x.aliases.every(nonempty),
    )
  );
}
function validateGold(gold, item) {
  if (
    !gold ||
    !['visible', 'critical', 'unknown', 'sources', 'contradictions'].every(
      (key) => checks(gold[key]),
    ) ||
    !gold.visible.length ||
    !gold.critical.length ||
    !gold.unknown.length ||
    !Array.isArray(gold.relations) ||
    !gold.relations.every((x) =>
      ['id', 'from', 'to', 'relation'].every((k) => nonempty(x[k])),
    ) ||
    !Array.isArray(gold.readingOrder) ||
    !gold.readingOrder.every(
      (x) => Array.isArray(x) && x.length >= 2 && x.every(nonempty),
    ) ||
    !gold.sources.every(
      (x) => Number.isInteger(x.page) && x.page > 0 && x.page <= item.pages,
    ) ||
    !Array.isArray(gold.tables)
  )
    throw new Error(`Invalid annotation: ${item.id}`);
  for (const table of gold.tables) {
    if (
      !Number.isInteger(table.page) ||
      table.page < 1 ||
      table.page > item.pages ||
      !Number.isInteger(table.rowCount) ||
      table.rowCount < 1 ||
      !Number.isInteger(table.columnCount) ||
      table.columnCount < 1 ||
      !Array.isArray(table.headerRows) ||
      !table.headerRows.every(
        (x) => Number.isInteger(x) && x > 0 && x <= table.rowCount,
      ) ||
      !Array.isArray(table.cells) ||
      !table.cells.length
    )
      throw new Error(`Invalid table annotation: ${item.id}`);
    const occupied = new Set();
    for (const [row, col, text, rows = 1, cols = 1] of table.cells) {
      if (
        ![row, col, rows, cols].every((x) => Number.isInteger(x) && x > 0) ||
        row + rows - 1 > table.rowCount ||
        col + cols - 1 > table.columnCount ||
        typeof text !== 'string'
      )
        throw new Error(`Invalid table cell: ${item.id}`);
      for (let r = row; r < row + rows; r++)
        for (let c = col; c < col + cols; c++) {
          const key = `${r}:${c}`;
          if (occupied.has(key))
            throw new Error(`Overlapping gold cells: ${item.id}`);
          occupied.add(key);
        }
    }
    if (occupied.size !== table.rowCount * table.columnCount)
      throw new Error(`Incomplete gold table: ${item.id}`);
  }
}
async function loadCorpus(directory) {
  const root = await realpath(directory);
  const bytes = await readFile(path.join(root, 'manifest.json'));
  const manifest = JSON.parse(bytes);
  const goldBytes = await readFile(path.join(root, 'gold.json'));
  const gold = JSON.parse(goldBytes);
  if (
    manifest.schema !== 'complex-corpus-v1' ||
    gold.schema !== 'complex-gold-v1' ||
    manifest.provenance !== 'authored-synthetic-yuanlan-v1' ||
    gold.provenance !== manifest.provenance ||
    digest(goldBytes) !== manifest.goldSha256 ||
    !Array.isArray(manifest.cases) ||
    !manifest.cases.length ||
    !Array.isArray(gold.cases) ||
    gold.cases.length !== manifest.cases.length ||
    new Set(gold.cases.map((x) => x.id)).size !== gold.cases.length
  )
    throw new Error('Invalid or changed corpus / gold hash');
  const ids = new Set();
  for (const item of manifest.cases) {
    if (
      typeof item.id !== 'string' ||
      !/^[a-z][a-z0-9-]+$/.test(item.id) ||
      ids.has(item.id) ||
      !categories.includes(item.category) ||
      !['development', 'holdout'].includes(item.split) ||
      !Number.isInteger(item.pages) ||
      item.pages < 1 ||
      typeof item.file !== 'string' ||
      path.isAbsolute(item.file) ||
      item.file.split(/[\\/]/).includes('..') ||
      !/\.(pdf|png)$/.test(item.file) ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      throw new Error('Invalid case identity or input path');
    ids.add(item.id);
    const file = await realpath(path.join(root, item.file));
    if (!file.startsWith(root + path.sep))
      throw new Error('Input path escapes corpus');
    if (digest(await readFile(file)) !== item.sha256)
      throw new Error(`Input hash mismatch: ${item.id}`);
    validateGold(
      gold.cases.find((x) => x.id === item.id),
      item,
    );
  }
  return {
    root,
    manifest,
    manifestSha256: digest(bytes),
    gold: new Map(gold.cases.map((x) => [x.id, x])),
  };
}
module.exports = { categories, digest, loadCorpus, validateGold };
