import { AnswerFailure } from './answer-failure';

export function classifyModelFailure(error: unknown): AnswerFailure {
  if (error instanceof AnswerFailure) return error;
  const chain: Record<string, unknown>[] = [];
  let current = error;
  for (let i = 0; i < 4 && current && typeof current === 'object'; i++) {
    chain.push(current as Record<string, unknown>);
    current = (current as Record<string, unknown>).cause;
  }
  const status = chain.find((e) => typeof e.status === 'number')?.status;
  const retryAfterMs = parseRetryAfter(chain);
  if (status === 401 || status === 403 || status === 400 || status === 404)
    return new AnswerFailure(
      'MODEL_CONFIGURATION_ERROR',
      'Chat model configuration failed',
    );
  if (status === 429) {
    return new AnswerFailure(
      'MODEL_RATE_LIMITED',
      'Chat model rate limited',
      retryAfterMs,
      true,
    );
  }
  if (
    status === 408 ||
    status === 504 ||
    chain.some((e) =>
      ['AbortError', 'TimeoutError', 'APIConnectionTimeoutError'].includes(
        String(e.name),
      ),
    )
  )
    return new AnswerFailure('MODEL_TIMEOUT', 'Chat model timed out');
  const transient =
    status === 502 ||
    status === 503 ||
    chain.some((e) =>
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'EPIPE',
        'EAI_AGAIN',
        'UND_ERR_SOCKET',
        'UND_ERR_CONNECT_TIMEOUT',
      ].includes(String(e.code)),
    );
  return new AnswerFailure(
    'MODEL_UNAVAILABLE',
    'Chat model unavailable',
    retryAfterMs,
    transient,
  );
}

function parseRetryAfter(chain: Record<string, unknown>[]): number | undefined {
  const headers = chain.find((e) => e.headers)?.headers as
    | { get?: (name: string) => string | null; [key: string]: unknown }
    | undefined;
  const raw = headers?.get?.('retry-after') ?? headers?.['retry-after'];
  const text = typeof raw === 'string' ? raw.trim() : '';
  const delay = text
    ? /^\d+(\.\d+)?$/.test(text)
      ? Number(text) * 1000
      : Date.parse(text) - Date.now()
    : undefined;
  const retryAfterMs =
    delay !== undefined && Number.isFinite(delay)
      ? Math.max(0, delay)
      : undefined;
  return retryAfterMs;
}
