const assert = require('node:assert/strict');
const { digest } = require('./values.cjs');
async function verifySource(
  env,
  actors,
  fixture,
  { id, route, document, candidate },
) {
  const { owner, outsider } = actors;
  const original = await owner(
    'GET',
    '/storage/object?key=' + encodeURIComponent(document.storageKey),
  );
  if (fixture.data) assert.equal(digest(original), digest(fixture.data));
  else {
    const snapshot = JSON.parse(original);
    assert.equal(snapshot.requestedUrl, fixture.url);
    assert.equal(snapshot.sha256, digest(snapshot.html));
  }
  await outsider(
    'GET',
    '/storage/access?key=' + encodeURIComponent(document.storageKey),
    undefined,
    403,
  );
  const keys = [
    document.storageKey,
    ...document.content.assets.map((x) => x.objectKey),
  ];
  for (const key of keys) {
    const bytes = await owner(
      'GET',
      '/storage/object?key=' + encodeURIComponent(key),
    );
    assert.ok(bytes.length);
    const ticket = await owner(
      'GET',
      '/storage/access?key=' + encodeURIComponent(key),
    );
    const response = await fetch(ticket.url);
    assert.equal(response.status, 200);
    assert.equal(
      digest(Buffer.from(await response.arrayBuffer())),
      digest(bytes),
    );
    if (key === document.storageKey) {
      const response = await fetch(
        ticket.url.replace(
          encodeURIComponent(key),
          encodeURIComponent('assets/' + id + '/wrong'),
        ),
      );
      assert.equal(response.status, 401);
    }
  }
  const evidence = await owner('GET', route + '/evidence?limit=100');
  const body = await env.db
    .collection('document_content')
    .findOne({ contentId: document.contentId });
  assert.equal(body.markdown, document.content.markdown);
  assert.deepEqual(body.tables, document.content.tables);
  const scan = fixture.scan;
  if (scan) {
    const table = document.content.tables.find(
      (t) => t.caption === scan.caption,
    );
    assert.ok(table, 'Recovered table missing');
    assert.equal(table.cells.length, 12);
    assert.equal(
      table.cells.find((c) => c.row === 4 && c.column === scan.blankColumn)
        .text,
      '',
    );
    assert.equal(table.source.page, 1);
    assert.ok(table.source.bbox);
    assert.equal(candidate.ready, false);
    assert.equal(candidate.quality.status, 'needs_review');
  }
  return { original, keys, evidence, body };
}
module.exports = { verifySource };
