const { digest } = require('./corpus.cjs');
const budgets = Object.freeze({
  INGESTION_MAX_FILE_BYTES: 104857600,
  INGESTION_MAX_CONTENT_BYTES: 4194304,
  INGESTION_MAX_PAGES: 1000,
  INGESTION_PARSE_CONCURRENCY: 1,
  MINERU_RESULT_MAX_BYTES: 67108864,
  MINERU_TIMEOUT_MS: 300000,
  MINERU_POLL_MS: 1000,
  MINERU_TIER: 'flash',
  visionMaxUniqueImages: 12,
  visionMaxInputBytes: 4194304,
  visionMaxOutputTokens: 1600,
  visionTemperature: 0,
  visionTimeoutMs: 60000,
});
function profile(name, env = process.env) {
  if (!['native-ocr', 'mineru-ocr', 'mineru-vision'].includes(name))
    throw new Error('Unknown quality profile');
  const mineru = name.startsWith('mineru');
  const vision = name.endsWith('vision');
  const options = {
    ...budgets,
    DOCUMENT_PARSER: mineru ? 'mineru' : 'native',
    IMAGE_ANALYSIS_MODE: vision ? 'describe' : 'ocr',
    MINERU_BASE_URL: env.MINERU_BASE_URL,
    MINERU_API_KEY: env.MINERU_API_KEY,
    MINERU_TRANSFER_ORIGINS: env.MINERU_TRANSFER_ORIGINS || '',
    VISION_BASE_URL: env.VISION_BASE_URL,
    VISION_MODEL: env.VISION_MODEL,
    VISION_MODEL_REVISION: env.VISION_MODEL_REVISION,
    VISION_API_KEY: env.VISION_API_KEY,
  };
  const missing = [];
  if (mineru)
    for (const key of ['MINERU_BASE_URL', 'QUALITY_MINERU_REVISION'])
      if (!env[key]?.trim()) missing.push(key);
  if (vision)
    for (const key of [
      'VISION_BASE_URL',
      'VISION_MODEL',
      'VISION_MODEL_REVISION',
    ])
      if (!env[key]?.trim()) missing.push(key);
  return {
    name,
    options,
    missing,
    identity: {
      parser: options.DOCUMENT_PARSER,
      imageMode: options.IMAGE_ANALYSIS_MODE,
      // Supplied deployment identity is not independent verification of server weights.
      mineruRevision: mineru ? env.QUALITY_MINERU_REVISION || null : null,
      visionModel: vision ? env.VISION_MODEL || null : null,
      visionRevision: vision ? env.VISION_MODEL_REVISION || null : null,
    },
  };
}
async function probe(configuration) {
  if (configuration.missing.length)
    return {
      available: false,
      code: 'MISSING_CONFIGURATION',
      missing: configuration.missing,
    };
  if (configuration.identity.parser === 'native') return { available: true };
  try {
    const url = new URL(
      'openapi.json',
      configuration.options.MINERU_BASE_URL.replace(/\/$/, '') + '/',
    );
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { available: false, code: 'MINERU_UNREACHABLE' };
    }
    const api = await response.json();
    if (!api.paths?.['/v1/tasks'])
      return { available: false, code: 'MINERU_PROTOCOL_MISMATCH' };
    return {
      available: true,
      apiSha256: digest(JSON.stringify(api)),
      serverVersion: api.info?.version || null,
    };
  } catch {
    return { available: false, code: 'MINERU_UNREACHABLE' };
  }
}
module.exports = { budgets, profile, probe };
