const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { httpClient } = require('./http.cjs');
test('HTTP harness records status and verifies JSON, original bytes, authentication and failures', async () => {
  const server = createServer((req, res) => {
    if (req.url.endsWith('/failure')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"code":"EXPECTED"}');
      return;
    }
    if (req.headers.authorization !== 'Bearer isolated-test-token') {
      res.writeHead(401);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"value":0}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const events = [],
      api = httpClient(
        `http://127.0.0.1:${server.address().port}`,
        'isolated-test-token',
        events,
      );
    assert.deepEqual(await api('GET', '/body'), { value: 0 });
    assert.ok(Buffer.isBuffer(await api('GET', '/storage/object?key=one')));
    await api('GET', '/failure', undefined, 400);
    await assert.rejects(api('GET', '/failure'), /400 !== 200/);
    assert.equal(events.length, 4);
    assert.equal(events[1].route, '/storage/object');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
