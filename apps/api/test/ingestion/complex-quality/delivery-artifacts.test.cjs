const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, mkdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const {
  safeFile,
  readCase,
  rewriteResult,
  assertContentPreserved,
  visualChunkDelivery,
  validateDeliveryRun,
} = require('./delivery-artifacts.cjs');
const { digest } = require('./corpus.cjs');
const { cleanupAll } = require('./delivery-environment.cjs');
test('delivery rejects duplicate, foreign or changed source identities before creating services', () => {
  const item = {
    id: 'one',
    sha256: 'bytes',
    category: 'chart',
    split: 'development',
  };
  const corpus = {
    manifestSha256: 'manifest',
    manifest: { goldSha256: 'gold', cases: [item] },
  };
  const run = {
    schema: 'complex-quality-run-v1',
    manifestSha256: 'manifest',
    goldSha256: 'gold',
    cases: [{ ...item, inputSha256: 'bytes' }],
  };
  assert.doesNotThrow(() => validateDeliveryRun(run, corpus));
  for (const mutation of [
    (x) => x.cases.push(x.cases[0]),
    (x) => {
      x.cases[0].inputSha256 = 'changed';
    },
    (x) => {
      x.cases[0].id = 'foreign';
    },
    (x) => {
      x.goldSha256 = 'changed';
    },
    (x) => {
      x.cases = [];
    },
  ]) {
    const changed = structuredClone(run);
    mutation(changed);
    assert.throws(() => validateDeliveryRun(changed, corpus));
  }
});
test('asset relocation handles overlapping URLs and adjusts UTF-16 ranges without rewriting new URLs', () => {
  const result = {
    markdown: '前🙂 ![a](/asset/1) ![b](/asset/10)\nvisual',
    assets: [
      { objectKey: 'a', url: '/asset/1' },
      { objectKey: 'b', url: '/asset/10' },
    ],
    evidence: [
      {
        id: 'a',
        objectKeys: ['a'],
        data: { markdownStart: 4, markdownEnd: 40 },
      },
    ],
    sections: [{ start: 4, end: 20, source: { page: 2 } }],
  };
  const out = rewriteResult(
    result,
    new Map([
      ['a', { objectKey: 'new-a', url: '/new/asset/10' }],
      ['b', { objectKey: 'new-b', url: '/new/ten' }],
    ]),
  );
  assert.equal(out.markdown, '前🙂 ![a](/new/asset/10) ![b](/new/ten)\nvisual');
  assert.equal(
    out.sections[0].end,
    result.sections[0].end + '/new/asset/10'.length - '/asset/1'.length,
  );
  assert.deepEqual(out.evidence[0].objectKeys, ['new-a']);
  assert.equal(result.evidence[0].objectKeys[0], 'a');
  assert.throws(() => rewriteResult(result, new Map()), /unknown asset/);
});
test('artifact loader rejects path traversal, changed bytes and unreferenced inventory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'quality-replay-'));
  try {
    await mkdir(path.join(dir, 'case'));
    const result = {
      markdown: 'raw',
      assets: [{ objectKey: 'key', url: '/asset/1' }],
    };
    await writeFile(path.join(dir, 'case/parsed.json'), JSON.stringify(result));
    await writeFile(path.join(dir, 'case/asset.bin'), 'pixels');
    await writeFile(
      path.join(dir, 'case/assets.json'),
      JSON.stringify([
        {
          objectKey: 'key',
          file: 'asset.bin',
          bytes: 6,
          sha256: digest('pixels'),
        },
      ]),
    );
    assert.equal((await readCase(dir, { id: 'case' })).assets.length, 1);
    await assert.rejects(safeFile(dir, '../outside'), /Unsafe/);
    await assert.rejects(readCase(dir, { id: '../outside' }), /Unsafe/);
    await writeFile(path.join(dir, 'case/asset.bin'), 'altered');
    await assert.rejects(readCase(dir, { id: 'case' }), /hash mismatch/);
    await writeFile(path.join(dir, 'case/assets.json'), '[]');
    await assert.rejects(readCase(dir, { id: 'case' }), /inventory mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed index cleanup never prevents storage or environment cleanup', async () => {
  const events = [];
  await assert.rejects(
    cleanupAll([
      () => {
        events.push('index');
        throw new Error('index unavailable');
      },
      async () => {
        events.push('storage');
      },
      async () => {
        events.push('environment');
      },
    ]),
    /cleanup incomplete/,
  );
  assert.deepEqual(events.sort(), ['environment', 'index', 'storage']);
  await assert.doesNotReject(cleanupAll([async () => {}]));
});
test('persistence comparison ignores JSON property order but rejects dropped uncertainty or source', () => {
  const input = {
    markdown: 'text',
    quality: { status: 'needs_review', issues: [] },
    evidence: [
      { id: 'image', source: { page: 2 }, data: { uncertain: ['unknown'] } },
    ],
  };
  const stored = {
    markdown: 'text',
    quality: { issues: [], status: 'needs_review' },
  };
  assert.doesNotThrow(() =>
    assertContentPreserved(input, stored, input.evidence),
  );
  const units = structuredClone(input.evidence);
  units[0].source.page = 1;
  assert.throws(() => assertContentPreserved(input, stored, units), /differs/);
  units[0] = structuredClone(input.evidence[0]);
  units[0].data.uncertain = [];
  assert.throws(() => assertContentPreserved(input, stored, units), /differs/);
});
test('visual description delivery requires content and correct source ranges together', () => {
  const result = {
    markdown: '### 图像机器描述（需核对）\n甲\n待核对: 乙',
    sections: [{ start: 0, end: 28, source: { page: 2 } }],
    evidence: [
      {
        id: 'desc',
        kind: 'image',
        text: '甲\n待核对: 乙',
        source: { page: 2 },
        data: { representation: 'visual_description' },
      },
    ],
  };
  const chunk = {
    content: result.markdown,
    ranges: [{ start: 0, end: 28, source: { page: 2 } }],
  };
  assert.equal(visualChunkDelivery(result, [chunk])[0].preservedParts, 2);
  chunk.ranges[0].source.page = 1;
  assert.equal(visualChunkDelivery(result, [chunk])[0].preservedParts, 0);
  chunk.ranges[0].source.page = 2;
  chunk.content = '甲';
  assert.equal(visualChunkDelivery(result, [chunk])[0].preservedParts, 1);
});
