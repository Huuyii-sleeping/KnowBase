const aliases = require('../../../../docs/baselines/ingestion-commit-aliases.json');
// Historical reports retain their original IDs; published commits have identical trees.
function baselineReference(ref) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-'))
    throw new Error('Invalid baseline reference');
  if (!/^[a-f0-9]{7,40}$/.test(ref)) return ref;
  const matches = Object.keys(aliases).filter((old) => old.startsWith(ref));
  if (matches.length > 1) throw new Error('Ambiguous historical reference');
  return matches.length ? aliases[matches[0]] : ref;
}
module.exports = { baselineReference };
