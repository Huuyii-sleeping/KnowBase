const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtimeIdentity } = require('./runtime.cjs');
const env = {
  MINERU_BASE_URL: 'http://127.0.0.1:18080',
  QUALITY_MINERU_REVISION: 'fixed',
  QUALITY_EMBEDDING_REVISION: 'sha256:embed',
  QUALITY_KG_REVISION: 'sha256:kg',
};
function request(changed = false) {
  return async (url) => ({
    ok: true,
    json: async () =>
      String(url).endsWith('openapi.json')
        ? { paths: { '/v1/tasks': {} }, info: { version: '4.2.3' } }
        : {
            models: [
              {
                name: 'nomic-embed-text:latest',
                digest: changed ? 'changed' : 'embed',
              },
              { name: 'qwen2.5:0.5b', digest: 'kg' },
            ],
          },
  });
}
test('runtime requires explicit identity and validates actual local model digests before services start', async () => {
  await assert.rejects(
    runtimeIdentity({}, () => {
      throw Error('must not fetch');
    }),
    /Missing/,
  );
  await assert.rejects(
    runtimeIdentity(env, request(true)),
    /Actual model differs/,
  );
  assert.equal(
    (await runtimeIdentity(env, request())).imageAnalysisMode,
    'ocr',
  );
});
