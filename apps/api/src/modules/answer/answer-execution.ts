import { AsyncLocalStorage } from 'node:async_hooks';
import { ANSWER_TOTAL_TIMEOUT_MS } from './answer-budget';
import { AnswerFailure } from './answer-failure';

export interface AnswerExecution {
  readonly signal: AbortSignal;
  readonly expiresAt: number;
  transportRetryUsed: boolean;
  modelCalls: number;
  transportRetries: number;
  lastFailureCode?: string;
  stage: 'retrieval' | 'context' | 'generation' | 'citation';
}
const executions = new AsyncLocalStorage<AnswerExecution>();
export const currentAnswerExecution = () => executions.getStore();

export function checkAnswerDeadline(): void {
  const execution = currentAnswerExecution();
  if (
    execution &&
    (execution.signal.aborted || Date.now() >= execution.expiresAt)
  )
    throw new AnswerFailure('ANSWER_TIMEOUT', 'Answer deadline exceeded');
}

export async function runWithAnswerDeadline<T>(
  work: (execution: AnswerExecution) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const execution: AnswerExecution = {
    signal: controller.signal,
    expiresAt: Date.now() + ANSWER_TOTAL_TIMEOUT_MS,
    transportRetryUsed: false,
    stage: 'retrieval',
    modelCalls: 0,
    transportRetries: 0,
  };
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new AnswerFailure(
        'ANSWER_TIMEOUT',
        'Answer deadline exceeded',
      );
      controller.abort(error);
      reject(error);
    }, ANSWER_TOTAL_TIMEOUT_MS);
  });
  try {
    return await executions.run(execution, async () => {
      const result = await Promise.race([work(execution), timeout]);
      checkAnswerDeadline();
      return result;
    });
  } finally {
    clearTimeout(timer);
  }
}
