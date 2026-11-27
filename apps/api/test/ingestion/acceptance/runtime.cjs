const assert = require('node:assert/strict');
async function runtimeIdentity(env = process.env, request = fetch) {
  for (const key of [
    'MINERU_BASE_URL',
    'QUALITY_MINERU_REVISION',
    'QUALITY_EMBEDDING_REVISION',
    'QUALITY_KG_REVISION',
  ])
    if (!env[key]) throw new Error('Missing ' + key);
  const mineru = await request(new URL('/openapi.json', env.MINERU_BASE_URL), {
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(mineru.ok, 'MinerU is unavailable');
  const api = await mineru.json();
  assert.ok(api.paths['/v1/tasks'], 'MinerU Tasks API missing');
  const models = await request('http://127.0.0.1:11434/api/tags', {
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(models.ok, 'Ollama is unavailable');
  const tags = await models.json();
  const identities = [
    ['nomic-embed-text:latest', env.QUALITY_EMBEDDING_REVISION],
    ['qwen2.5:0.5b', env.QUALITY_KG_REVISION],
  ];
  for (const [name, revision] of identities)
    assert.equal(
      'sha256:' + tags.models.find((x) => x.name === name)?.digest,
      revision,
      'Actual model differs: ' + name,
    );
  return {
    mineru: env.QUALITY_MINERU_REVISION,
    mineruServerVersion: api.info.version,
    embedding: env.QUALITY_EMBEDDING_REVISION,
    kg: env.QUALITY_KG_REVISION,
    imageAnalysisMode: 'ocr',
  };
}
module.exports = { runtimeIdentity };
