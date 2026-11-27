const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FaultControl } = require('./fault-control.cjs');
test('fault control pauses only matching document, releases deterministically and fails a bounded number of attempts', async () => {
  const messages = [],
    faults = new FaultControl((m) => messages.push(m));
  assert.throws(() => faults.arm({ action: 'unknown' }), /Invalid/);
  assert.throws(() => faults.release('missing'), /No paused/);
  faults.arm({
    id: 'pause',
    point: 'apply',
    action: 'pause',
    documentId: 'one',
  });
  await faults.hit('apply', 'two');
  assert.equal(messages.length, 0);
  let finished = false;
  const waiting = faults.hit('apply', 'one').then(() => {
    finished = true;
  });
  assert.equal(finished, false);
  assert.equal(messages[0].id, 'pause');
  faults.release('pause');
  await waiting;
  assert.equal(finished, true);
  faults.arm({ id: 'fail', point: 'apply', action: 'throw', times: 2 });
  await assert.rejects(faults.hit('apply', 'one'), /fail/);
  await assert.rejects(faults.hit('apply', 'one'), /fail/);
  await faults.hit('apply', 'one');
  assert.equal(faults.counts['apply:one'], 4);
});
