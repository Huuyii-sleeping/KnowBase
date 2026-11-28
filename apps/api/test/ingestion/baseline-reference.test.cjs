const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { baselineReference } = require('./baseline-reference.cjs');
const aliases = require('../../../../docs/baselines/ingestion-commit-aliases.json');
test('historical short and full commits resolve to published identical source trees', () => {
  for (const [old, published] of Object.entries(aliases)) {
    assert.equal(baselineReference(old), published);
    assert.equal(baselineReference(old.slice(0, 7)), published);
    assert.match(
      execFileSync('git', ['rev-parse', '--verify', published + '^{tree}'], {
        encoding: 'utf8',
      }).trim(),
      /^[a-f0-9]{40}$/,
    );
  }
});
test('ordinary refs pass through and invalid refs fail', () => {
  assert.equal(baselineReference('HEAD'), 'HEAD');
  assert.equal(baselineReference('0123456'), '0123456');
  for (const ref of ['', null, '--all'])
    assert.throws(() => baselineReference(ref));
});
