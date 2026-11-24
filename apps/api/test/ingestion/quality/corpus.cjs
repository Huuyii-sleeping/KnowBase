const { readFile, realpath } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function loadCorpus(directory) {
  const root = await realpath(directory);
  const manifestBytes = await readFile(path.join(root, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (
    manifest.schema !== 'ingestion-quality-v1' ||
    !['authored-synthetic-business-v1', 'human-annotated-business-v1'].includes(
      manifest.provenance,
    ) ||
    !Array.isArray(manifest.cases) ||
    !manifest.cases.length
  )
    throw new Error('Invalid corpus manifest');
  const ids = new Set();
  for (const item of manifest.cases) {
    if (
      !/^[a-z][a-z0-9-]{0,80}$/.test(item.id) ||
      ids.has(item.id) ||
      !['development', 'holdout'].includes(item.split) ||
      item.kind !== 'document' ||
      !/^[a-f0-9]{64}$/.test(item.sha256 || '') ||
      typeof item.file !== 'string' ||
      path.isAbsolute(item.file)
    )
      throw new Error('Invalid corpus case identity or hash');
    ids.add(item.id);
    const target = await realpath(path.resolve(root, item.file));
    if (!target.startsWith(root + path.sep))
      throw new Error('Corpus path escapes root');
    const bytes = await readFile(target);
    if (digest(bytes) !== item.sha256)
      throw new Error(`Corpus hash mismatch: ${item.id}`);
    if (
      !Array.isArray(item.facts) ||
      item.facts.some(
        (aliases) =>
          !Array.isArray(aliases) ||
          !aliases.length ||
          aliases.some(
            (text) => typeof text !== 'string' || !/[\p{L}\p{N}]/u.test(text),
          ),
      )
    )
      throw new Error('Invalid fact annotations');
  }
  return { ...manifest, manifestSha256: digest(manifestBytes), root };
}
module.exports = { digest, loadCorpus };
