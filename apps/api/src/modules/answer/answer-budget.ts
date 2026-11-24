// Keep a conservative application input budget across answer providers.
// UTF8 bytes are not exact token counts; the Ollama context is set separately.
export const ANSWER_PROMPT_MAX_BYTES = 26000;
export const ANSWER_MODEL_CONTEXT_TOKENS = 32768;
// Structured claims duplicate answer facts in verbatim evidence quotes.
// The measured twelve-rule answer exceeds 1,024 tokens even without reasoning.
export const ANSWER_MODEL_MAX_OUTPUT_TOKENS = 4096;

export const ANSWER_MODEL_TIMEOUT_MS = 30000;

// Shared across retrieval, generation, citation repair and transport recovery.
export const ANSWER_TOTAL_TIMEOUT_MS = 45000;
