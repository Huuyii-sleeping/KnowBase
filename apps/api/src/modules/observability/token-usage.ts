export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

// LangChain normalizes OpenAI and Ollama usage; older Ollama responses retain
// counts in response_metadata. Never infer unknown usage as zero.
export function readTokenUsage(response: {
  usage_metadata?: unknown;
  response_metadata?: Record<string, unknown>;
}): TokenUsage {
  const usage = response.usage_metadata as Record<string, unknown> | undefined;
  const metadata = response.response_metadata;
  const inputTokens = count(usage?.input_tokens ?? metadata?.prompt_eval_count);
  const outputTokens = count(usage?.output_tokens ?? metadata?.eval_count);
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      count(usage?.total_tokens) ??
      (inputTokens !== null && outputTokens !== null
        ? count(inputTokens + outputTokens)
        : null),
  };
}
