const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { tmpdir } = require('node:os');
const {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  symlink,
} = require('node:fs/promises');
const {
  digest,
  loadCorpus,
  validateGold,
  categories,
} = require('./corpus.cjs');
const { root } = require('./trace.cjs');
const { profile, probe } = require('./profile.cjs');
const { assetCapture, saveArtifacts } = require('./artifacts.cjs');
const { evaluate } = require('./evaluate.cjs');
const { fingerprint } = require('./trace.cjs');
const { compareFiles } = require('./compare.cjs');
const source = path.join(root, 'benchmarks/ingestion-complex');
async function fixture(dir, split = 'development') {
  const annotations = JSON.parse(
    await readFile(path.join(source, 'annotations.json'), 'utf8'),
  );
  const gold = {
    ...annotations,
    cases: [annotations.cases.find((x) => x.id === `scanned-table-${split}`)],
  };
  const goldBytes = JSON.stringify(gold);
  const item = {
    id: gold.cases[0].id,
    file: 'fixture.pdf',
    category: 'scanned-table',
    split,
    pages: 1,
    sha256: digest('fixture bytes'),
  };
  const manifest = {
    schema: 'complex-corpus-v1',
    provenance: gold.provenance,
    goldSha256: digest(goldBytes),
    cases: [item],
  };
  await mkdir(dir);
  await writeFile(path.join(dir, 'fixture.pdf'), 'fixture bytes');
  await writeFile(path.join(dir, 'gold.json'), goldBytes);
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return {
    manifest,
    item,
    gold,
    write: () =>
      writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest)),
  };
}
test('new source inventory is balanced, complete, separate from historical corpora', async () => {
  const layouts = JSON.parse(
    await readFile(path.join(source, 'layouts.json'), 'utf8'),
  );
  const gold = JSON.parse(
    await readFile(path.join(source, 'annotations.json'), 'utf8'),
  );
  assert.equal(layouts.cases.length, 14);
  assert.equal(gold.cases.length, 14);
  assert.equal(layouts.cases.filter((x) => x.file.endsWith('.pdf')).length, 8);
  for (const category of categories)
    for (const split of ['development', 'holdout']) {
      const items = layouts.cases.filter(
        (x) => x.category === category && x.split === split,
      );
      assert.equal(items.length, 1);
      validateGold(
        gold.cases.find((x) => x.id === items[0].id),
        { ...items[0], pages: items[0].pages.length },
      );
    }
});
test('loader checks input/gold hashes, unique IDs, safe paths, categories and splits', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'complex-corpus-'));
  try {
    const out = path.join(dir, 'corpus');
    const data = await fixture(out);
    assert.equal((await loadCorpus(out)).manifest.cases.length, 1);
    for (const [key, invalid] of [
      ['category', 'video'],
      ['split', 'training'],
      ['file', '../fixture.pdf'],
      ['sha256', digest('changed')],
    ]) {
      const before = data.item[key];
      data.item[key] = invalid;
      await data.write();
      await assert.rejects(loadCorpus(out));
      data.item[key] = before;
    }
    data.manifest.cases.push({ ...data.item });
    await data.write();
    await assert.rejects(loadCorpus(out));
    data.manifest.cases.pop();
    await data.write();
    await writeFile(path.join(out, 'gold.json'), '{}');
    await assert.rejects(loadCorpus(out), /gold hash/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('loader rejects symlink escapes and invalid/overlapping gold cells', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'complex-path-'));
  try {
    const out = path.join(dir, 'corpus');
    const data = await fixture(out);
    await writeFile(path.join(dir, 'outside.pdf'), 'fixture bytes');
    await symlink(path.join(dir, 'outside.pdf'), path.join(out, 'link.pdf'));
    data.item.file = 'link.pdf';
    await data.write();
    await assert.rejects(loadCorpus(out), /escapes/);
    const gold = structuredClone(data.gold.cases[0]);
    gold.tables[0].cells.push([1, 1, 'overlap']);
    assert.throws(() => validateGold(gold, data.item), /Overlapping/);
    gold.tables[0].cells.pop();
    gold.critical[0].aliases = [' '];
    assert.throws(() => validateGold(gold, data.item), /annotation/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('profiles require explicit real-model identities and never silently fall back', async () => {
  assert.throws(() => profile('mock'), /Unknown/);
  assert.equal((await probe(profile('native-ocr', {}))).available, true);
  const config = profile('mineru-vision', {});
  assert.ok(config.missing.includes('VISION_MODEL_REVISION'));
  assert.equal((await probe(config)).code, 'MISSING_CONFIGURATION');
});

test('fingerprints ignore Python cache bytes and preserve source changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'complex-trace-'));
  try {
    await writeFile(path.join(dir, 'source.py'), 'first');
    const first = await fingerprint(dir);
    await mkdir(path.join(dir, '__pycache__'));
    await writeFile(path.join(dir, '__pycache__/source.pyc'), 'runtime cache');
    assert.equal((await fingerprint(dir)).sha256, first.sha256);
    await writeFile(path.join(dir, 'source.py'), 'changed');
    assert.notEqual((await fingerprint(dir)).sha256, first.sha256);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('comparison file writer rejects stale destinations and incompatible reports', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'complex-compare-'));
  try {
    const base = {
      schema: 'complex-quality-run-v1',
      manifestSha256: 'manifest',
      goldSha256: 'gold',
      scorerSha256: 'scorer',
      budgets: {},
      cases: [
        {
          id: 'one',
          inputSha256: 'input',
          split: 'development',
          category: 'chart',
          status: 'unavailable',
        },
      ],
    };
    const before = path.join(dir, 'before.json'),
      after = path.join(dir, 'after.json'),
      out = path.join(dir, 'comparison.json');
    await writeFile(before, JSON.stringify(base));
    await writeFile(after, JSON.stringify(base));
    assert.equal((await compareFiles(before, after, out))[0].comparable, false);
    await assert.rejects(compareFiles(before, after, out), { code: 'EEXIST' });
    base.goldSha256 = 'changed';
    await writeFile(after, JSON.stringify(base));
    await assert.rejects(
      compareFiles(before, after, path.join(dir, 'bad.json')),
      /same corpus/,
    );
    await assert.rejects(readFile(path.join(dir, 'bad.json')), {
      code: 'ENOENT',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('local artifacts preserve bytes and serialization; discard cleans captured uploads', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'complex-artifact-'));
  try {
    const capture = assetCapture();
    const asset = await capture.uploader.upload('doc', {
      data: Buffer.from([1, 2, 3]),
      contentType: 'image/png',
    });
    const result = { markdown: 'raw', ready: false, evidence: [] };
    assert.equal(
      (await saveArtifacts(path.join(dir, 'ok'), result, capture)).assets,
      1,
    );
    assert.deepEqual(
      await readFile(path.join(dir, 'ok', 'asset-0.bin')),
      Buffer.from([1, 2, 3]),
    );
    await capture.uploader.discard('doc', [asset]);
    assert.equal(capture.entries.size, 0);
    const circular = { markdown: 'bad' };
    circular.self = circular;
    await assert.rejects(
      saveArtifacts(path.join(dir, 'bad'), circular, capture),
    );
    await assert.rejects(readFile(path.join(dir, 'bad', 'parsed.json')), {
      code: 'ENOENT',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('runner persists completed, unavailable, failed and holdout exposure states; fakes only test plumbing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'complex-run-'));
  try {
    const corpus = path.join(dir, 'corpus');
    await fixture(corpus, 'holdout');
    let received;
    const adapters = {
      probe: async () => ({ available: true }),
      infer: async (...args) => {
        received = args;
        return {
          result: {
            markdown: 'no recognized text',
            ready: false,
            quality: { status: 'needs_review' },
            parser: 'test-fixture',
          },
          assets: assetCapture(),
          requests: { mineru: 0, vision: 0, other: 0 },
          elapsedMs: 1,
        };
      },
    };
    const out = path.join(dir, 'done');
    const done = await evaluate(corpus, out, 'native-ocr', 'all', adapters);
    assert.equal(received.length, 3);
    assert.ok(Buffer.isBuffer(received[0]));
    assert.equal(received[2].gold, undefined);
    assert.equal(done.status, 'completed');
    assert.equal(done.holdoutExposure.length, 1);
    assert.equal(done.cases[0].score.critical.matched, 0);
    assert.equal(
      JSON.parse(await readFile(path.join(out, 'run.json'), 'utf8')).status,
      'completed',
    );
    await assert.rejects(evaluate(corpus, out, 'native-ocr', 'all', adapters), {
      code: 'EEXIST',
    });
    adapters.probe = async () => ({ available: false, code: 'NO_MODEL' });
    const pending = await evaluate(
      corpus,
      path.join(dir, 'pending'),
      'mineru-vision',
      'all',
      adapters,
    );
    assert.equal(pending.status, 'partial');
    assert.equal(pending.cases[0].score, undefined);
    assert.equal(pending.holdoutExposure.length, 0);
    adapters.probe = async () => ({ available: true });
    adapters.infer = async () => {
      throw new Error('secret provider details');
    };
    const failed = await evaluate(
      corpus,
      path.join(dir, 'failed'),
      'native-ocr',
      'all',
      adapters,
    );
    assert.equal(failed.status, 'failed');
    assert.equal(failed.cases[0].reason, 'INFERENCE_OR_ARTIFACT_FAILURE');
    assert.ok(!JSON.stringify(failed).includes('secret provider details'));
    assert.equal(failed.holdoutExposure.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
