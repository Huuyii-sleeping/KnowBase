const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { readBody } = require('./bge-integration.cjs');

test('fixture transport preserves Chinese and emoji when TCP splits UTF8 bytes', async () => {
  const value = {
    query: '历史权限😀',
    candidates: [{ content: '逐人授权，编号不构成权限。' }],
  };
  const bytes = Buffer.from(JSON.stringify(value));
  const fragments = Array.from(bytes, (byte) => Buffer.from([byte]));
  assert.deepEqual(await readBody(Readable.from(fragments)), value);
  await assert.rejects(readBody(Readable.from([Buffer.from('{bad')])));
});
