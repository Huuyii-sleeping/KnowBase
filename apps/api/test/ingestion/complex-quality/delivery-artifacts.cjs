const path = require('node:path');
const { readFile, realpath } = require('node:fs/promises');
const { digest } = require('./corpus.cjs');
const { isDeepStrictEqual } = require('node:util');
const equal = (a, b) => {
  const json = (value) =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  return isDeepStrictEqual(json(a), json(b));
};
function validateDeliveryRun(run, corpus) {
  if (
    run.schema !== 'complex-quality-run-v1' ||
    run.manifestSha256 !== corpus.manifestSha256 ||
    run.goldSha256 !== corpus.manifest.goldSha256 ||
    !Array.isArray(run.cases) ||
    !run.cases.length ||
    new Set(run.cases.map((x) => x.id)).size !== run.cases.length
  )
    throw new Error('Delivery requires a unique pinned source run');
  for (const row of run.cases) {
    const item = corpus.manifest.cases.find((x) => x.id === row.id);
    if (
      !item ||
      item.sha256 !== row.inputSha256 ||
      item.category !== row.category ||
      item.split !== row.split
    )
      throw new Error('Run case identity differs');
  }
}
async function safeFile(directory, relative) {
  const root = await realpath(directory);
  if (
    typeof relative !== 'string' ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes('..')
  )
    throw new Error('Unsafe artifact path');
  const file = await realpath(path.join(root, relative));
  if (!file.startsWith(root + path.sep))
    throw new Error('Artifact escapes run directory');
  return readFile(file);
}
async function readCase(directory, row) {
  if (typeof row.id !== 'string' || !/^[a-z][a-z0-9-]+$/.test(row.id))
    throw new Error('Unsafe case identity');
  const caseDir = path.join(directory, row.id);
  const resultBytes = await safeFile(caseDir, 'parsed.json');
  const inventoryBytes = await safeFile(caseDir, 'assets.json');
  const result = JSON.parse(resultBytes);
  const inventory = JSON.parse(inventoryBytes);
  if (
    !Array.isArray(inventory) ||
    !Array.isArray(result.assets) ||
    inventory.length !== result.assets.length ||
    new Set(inventory.map((x) => x.objectKey)).size !== inventory.length
  )
    throw new Error('Asset inventory mismatch');
  const assets = [];
  for (const item of inventory) {
    const bytes = await safeFile(caseDir, item.file);
    if (
      bytes.length !== item.bytes ||
      digest(bytes) !== item.sha256 ||
      !result.assets.some((x) => x.objectKey === item.objectKey)
    )
      throw new Error('Asset hash mismatch');
    assets.push({ ...item, data: bytes });
  }
  return {
    result,
    assets,
    parsedSha256: digest(resultBytes),
    inventorySha256: digest(inventoryBytes),
  };
}
function rewriteResult(result, replacements) {
  const remapText = (text) => {
    const urls = new Map(
      [...replacements].map(([old, asset]) => [
        result.assets.find((x) => x.objectKey === old).url,
        asset.url,
      ]),
    );
    const pattern = [...urls.keys()]
      .sort((a, b) => b.length - a.length)
      .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    return pattern
      ? text.replace(new RegExp(pattern, 'g'), (match) => urls.get(match))
      : text;
  };
  const evidence = (result.evidence || []).map((unit) => ({
    ...unit,
    objectKeys: unit.objectKeys.map((key) => {
      const asset = replacements.get(key);
      if (!asset) throw new Error('Evidence refers to an unknown asset');
      return asset.objectKey;
    }),
  }));
  // URL lengths change UTF-16 offsets. Transform every original prefix, including section boundaries.
  const offset = (index) => remapText(result.markdown.slice(0, index)).length;
  for (const unit of evidence)
    for (const key of ['markdownStart', 'markdownEnd']) {
      if (Number.isInteger(unit.data[key]))
        unit.data = { ...unit.data, [key]: offset(unit.data[key]) };
    }
  return {
    ...result,
    markdown: remapText(result.markdown),
    evidence,
    sections: (result.sections || []).map((s) => ({
      ...s,
      start: offset(s.start),
      end: offset(s.end),
    })),
    assets: result.assets.map((x) => {
      const replacement = replacements.get(x.objectKey);
      if (!replacement) throw new Error('Missing uploaded asset');
      return replacement;
    }),
  };
}
function assertContentPreserved(input, stored, units) {
  for (const key of [
    'markdown',
    'sections',
    'quality',
    'parseStrategy',
    'provenance',
    'assets',
    'ready',
  ]) {
    if (!equal(input[key], stored[key]))
      throw new Error(`Stored ${key} differs`);
  }
  for (const unit of input.evidence || []) {
    const actual = units.find((x) => x.id === unit.id);
    if (
      !actual ||
      Object.keys(unit).some((key) => !equal(unit[key], actual[key]))
    )
      throw new Error('Stored image evidence differs');
  }
}
function visualChunkDelivery(result, chunks) {
  const descriptions = (result.evidence || []).filter(
    (x) => x.data?.representation === 'visual_description',
  );
  return descriptions.map((unit) => {
    const sections = (result.sections || []).filter((s) =>
      result.markdown.slice(s.start, s.end).includes(unit.text),
    );
    const candidates = chunks.filter((chunk) =>
      chunk.ranges.some((range) =>
        sections.some(
          (s) =>
            range.start < s.end &&
            range.end > s.start &&
            Object.entries(unit.source).every(([key, value]) =>
              equal(range.source?.[key], value),
            ),
        ),
      ),
    );
    const parts = unit.text.split('\n').filter((x) => x.trim());
    return {
      id: unit.id,
      expectedParts: parts.length,
      preservedParts: parts.filter((part) =>
        candidates.some((chunk) => chunk.content.includes(part)),
      ).length,
      sourceChunks: candidates.length,
    };
  });
}
module.exports = {
  validateDeliveryRun,
  safeFile,
  readCase,
  rewriteResult,
  assertContentPreserved,
  visualChunkDelivery,
};
