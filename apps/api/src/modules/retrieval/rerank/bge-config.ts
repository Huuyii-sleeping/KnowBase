import { ConfigService } from '@nestjs/config';

export function bgeConfig(config: ConfigService) {
  const mode = config.get<string>('RAG_RERANKER', 'bge');
  if (mode !== 'rule' && mode !== 'bge') {
    throw new Error('RAG_RERANKER must be rule or bge');
  }
  const endpoint = config.get<string>(
    'BGE_RERANK_URL',
    'http://127.0.0.1:18081',
  );
  const url = new URL(endpoint);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'BGE_RERANK_URL must be an HTTP origin without credentials',
    );
  }
  const timeoutMs = Number(config.get('BGE_RERANK_TIMEOUT_MS', 20000));
  const cooldownMs = Number(config.get('BGE_RERANK_COOLDOWN_MS', 30000));
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120000 ||
    !Number.isInteger(cooldownMs) ||
    cooldownMs < 1 ||
    cooldownMs > 300000
  ) {
    throw new Error('Invalid BGE timeout or cooldown');
  }
  return { mode, endpoint: url.origin, timeoutMs, cooldownMs };
}
