import { ANSWER_MODEL_TIMEOUT_MS } from './answer-budget';

interface ModelResponse {
  content: unknown;
  response_metadata?: Record<string, unknown>;
}

// Both transports share an independent deadline: adapter cancellation alone
// may return an unfinished prefix or never settle a stalled invocation.
export async function invokeAnswerModel(
  invoke: (signal: AbortSignal) => Promise<ModelResponse>,
): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Chat model timed out'));
    }, ANSWER_MODEL_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([invoke(controller.signal), deadline]);
    controller.signal.throwIfAborted();
    const reason =
      response.response_metadata?.done_reason ??
      response.response_metadata?.finish_reason;
    if (reason === 'length')
      throw new Error('Chat model output exceeded its budget');
    if (reason && reason !== 'stop')
      throw new Error('Chat model did not complete a text answer');
    const text = toText(response.content);
    if (!text) throw new Error('Chat model returned an empty answer');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function toText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) => {
      if (typeof part === 'string') return part;
      if (
        part &&
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string'
      )
        return part.text;
      return '';
    })
    .join('')
    .trim();
}
