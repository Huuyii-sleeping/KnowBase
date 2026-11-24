import { AsyncLocalStorage } from 'node:async_hooks';
import {
  emitAnswerTelemetry,
  onAnswerFinished,
  safeErrorCode,
} from './answer-telemetry';
import { readTokenUsage, TokenUsage } from './token-usage';

type Purpose = 'initial' | 'citation_repair';
interface ModelCall {
  usage: TokenUsage;
  finishReason: string | null;
}
const calls = new AsyncLocalStorage<ModelCall>();
const purposes = new AsyncLocalStorage<Purpose>();

export function withModelPurpose<T>(purpose: Purpose, work: () => T): T {
  return purposes.run(purpose, work);
}

export function captureModelResponse(response: {
  usage_metadata?: unknown;
  response_metadata?: Record<string, unknown>;
}): void {
  const call = calls.getStore();
  if (!call) return;
  call.usage = readTokenUsage(response);
  const reason =
    response.response_metadata?.done_reason ??
    response.response_metadata?.finish_reason;
  // Only known finish categories go to local telemetry, never provider text.
  call.finishReason = [
    'stop',
    'length',
    'content_filter',
    'tool_calls',
  ].includes(String(reason))
    ? String(reason)
    : null;
}

export async function observeModelCall<T>(
  model: string,
  work: () => Promise<T>,
): Promise<T> {
  const call: ModelCall = {
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    finishReason: null,
  };
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const purpose = purposes.getStore() ?? 'initial';
  return calls.run(call, async () => {
    let ended = false;
    const end = (
      outcome: 'completed' | 'error' | 'interrupted',
      errorCode?: string,
    ) => {
      if (ended) return;
      ended = true;
      emitAnswerTelemetry({
        event: 'rag.answer.model',
        model,
        purpose,
        startedAt,
        latencyMs: performance.now() - started,
        outcome,
        errorCode,
        ...call,
      });
    };
    const unsubscribe = onAnswerFinished((code) => end('interrupted', code));
    try {
      const result = await work();
      end('completed');
      return result;
    } catch (error) {
      end('error', safeErrorCode(error));
      throw error;
    } finally {
      unsubscribe();
    }
  });
}
