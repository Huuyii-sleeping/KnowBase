import { setTimeout as delay } from 'node:timers/promises';
import { ANSWER_MODEL_TIMEOUT_MS } from './answer-budget';
import {
  checkAnswerDeadline,
  currentAnswerExecution,
} from './answer-execution';
import { AnswerFailure } from './answer-failure';
import { classifyModelFailure } from './model-failure-classifier';
import { emitAnswerTelemetry } from '../observability/answer-telemetry';
import { observeModelCall } from '../observability/model-call-telemetry';

// Only transport recovery lives here; content/citation repair is a separate step.
export async function invokeWithModelRecovery<T>(
  invoke: (signal: AbortSignal) => Promise<T>,
  model = 'unknown',
): Promise<T> {
  const execution = currentAnswerExecution();
  let localRetryUsed = false;
  while (true) {
    checkAnswerDeadline();
    try {
      if (execution) execution.modelCalls++;
      return await observeModelCall(model, async () => {
        try {
          return await invokeOnce(invoke, execution?.signal);
        } catch (error) {
          checkAnswerDeadline();
          throw classifyModelFailure(error);
        }
      });
    } catch (error) {
      checkAnswerDeadline();
      const failure = classifyModelFailure(error);
      if (execution) execution.lastFailureCode = failure.code;
      const waitMs = Math.max(
        failure.retryAfterMs ?? 0,
        250 + Math.floor(Math.random() * 251),
      );
      const remainingMs = execution
        ? execution.expiresAt - Date.now()
        : Infinity;
      // Never repeat a timed-out generation or consume the final answer budget
      // waiting through a long rate limit. One recovery across citation repair too.
      if (
        !failure.transient ||
        (execution?.transportRetryUsed ?? localRetryUsed) ||
        waitMs > 2000 ||
        remainingMs < waitMs + 5000
      )
        throw failure;
      localRetryUsed = true;
      if (execution) {
        execution.transportRetryUsed = true;
        execution.transportRetries++;
      }
      emitAnswerTelemetry({
        event: 'rag.answer.retry',
        waitMs,
        errorCode: failure.code,
      });
      try {
        await delay(waitMs, undefined, { signal: execution?.signal });
      } catch {
        checkAnswerDeadline();
        throw failure;
      }
    }
  }
}

async function invokeOnce<T>(
  invoke: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
): Promise<T> {
  if (parent?.aborted)
    throw new AnswerFailure('ANSWER_TIMEOUT', 'Answer deadline exceeded');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    const stop = (error: AnswerFailure) => {
      controller.abort(error);
      reject(error);
    };
    onAbort = () =>
      stop(new AnswerFailure('ANSWER_TIMEOUT', 'Answer deadline exceeded'));
    parent?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(
      () => stop(new AnswerFailure('MODEL_TIMEOUT', 'Chat model timed out')),
      ANSWER_MODEL_TIMEOUT_MS,
    );
  });
  try {
    controller.signal.throwIfAborted();
    const result = await Promise.race([invoke(controller.signal), deadline]);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort) parent?.removeEventListener('abort', onAbort);
  }
}
