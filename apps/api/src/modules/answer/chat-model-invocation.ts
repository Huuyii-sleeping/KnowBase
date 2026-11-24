import { AnswerFailure } from './answer-failure';
import { invokeWithModelRecovery } from './model-transport';
import { captureModelResponse } from '../observability/model-call-telemetry';

interface ModelResponse {
  content: unknown;
  response_metadata?: Record<string, unknown>;
  usage_metadata?: unknown;
}

// Both transports share an independent deadline: adapter cancellation alone
// may return an unfinished prefix or never settle a stalled invocation.
export async function invokeAnswerModel(
  invoke: (signal: AbortSignal) => Promise<ModelResponse>,
  model = 'unknown',
): Promise<string> {
  return invokeWithModelRecovery(async (signal) => {
    const response = await invoke(signal);
    captureModelResponse(response);
    return validateResponse(response);
  }, model);
}

function validateResponse(response: ModelResponse): string {
  const reason =
    response.response_metadata?.done_reason ??
    response.response_metadata?.finish_reason;
  if (reason === 'length')
    throw new AnswerFailure(
      'MODEL_OUTPUT_LIMIT',
      'Chat model output exceeded its budget',
    );
  if (reason && reason !== 'stop')
    throw new AnswerFailure(
      'MODEL_INVALID_RESPONSE',
      'Chat model did not complete a text answer',
    );
  const text = toText(response.content);
  if (!text)
    throw new AnswerFailure(
      'MODEL_INVALID_RESPONSE',
      'Chat model returned an empty answer',
    );
  return text;
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
