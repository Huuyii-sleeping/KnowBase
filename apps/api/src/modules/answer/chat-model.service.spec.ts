import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), constructor: vi.fn() }));
vi.mock('@langchain/ollama', () => ({
  ChatOllama: class {
    constructor(options: unknown) {
      mocks.constructor(options);
    }
    invoke = mocks.invoke;
  },
}));
import { ChatModelService } from './chat-model.service';

describe('ChatModelService Ollama compatibility', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it('keeps the model choice and seed, bounds output, and allocates room for the complete prompt', async () => {
    mocks.invoke.mockResolvedValue({ content: '答案 [S1]' });
    const service = new ChatModelService(
      new ConfigService({ CHAT_MODEL_PROVIDER: 'ollama' }),
    );
    expect(mocks.constructor).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen2.5:7b',
        seed: 42,
        temperature: 0,
        numCtx: 32768,
        numPredict: 4096,
      }),
    );
    expect(await service.generate('prompt')).toBe('答案 [S1]');
    expect(mocks.invoke).toHaveBeenCalledWith('prompt', {
      signal: expect.any(AbortSignal),
    });
  });
  it('preserves configured model choice and surfaces transport failures', async () => {
    mocks.invoke.mockRejectedValue(new Error('offline'));
    const service = new ChatModelService(
      new ConfigService({
        CHAT_MODEL_PROVIDER: 'ollama',
        OLLAMA_CHAT_MODEL: 'configured-model',
      }),
    );
    expect(mocks.constructor).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'configured-model' }),
    );
    await expect(service.generate('prompt')).rejects.toThrow(
      'Chat model unavailable',
    );
  });
  it('rejects a token-limit truncation rather than returning an answer prefix', async () => {
    const service = new ChatModelService(
      new ConfigService({ CHAT_MODEL_PROVIDER: 'ollama' }),
    );
    mocks.invoke.mockResolvedValue({
      content: 'partial [S1]',
      response_metadata: { done_reason: 'length' },
    });
    await expect(service.generate('prompt')).rejects.toThrow(
      'exceeded its budget',
    );
  });
  it('enforces its deadline even if the streaming adapter never emits or observes abort', async () => {
    vi.useFakeTimers();
    mocks.invoke.mockReturnValue(new Promise(() => {}));
    const result = new ChatModelService(
      new ConfigService({ CHAT_MODEL_PROVIDER: 'ollama' }),
    ).generate('prompt');
    const checked = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30000);
    await checked;
    expect(mocks.invoke.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects unsupported provider names instead of silently selecting a local model', () => {
    expect(
      () =>
        new ChatModelService(
          new ConfigService({ CHAT_MODEL_PROVIDER: 'unknown' }),
        ),
    ).toThrow('CHAT_MODEL_PROVIDER must be deepseek or ollama');
  });
  it('requires a DeepSeek key by default, without silently falling back to Ollama', () => {
    expect(
      () => new ChatModelService(new ConfigService({ DEEPSEEK_API_KEY: ' ' })),
    ).toThrow('DEEPSEEK_API_KEY is required');
  });
  it('cleans up the deadline after a successful call', async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValue({ content: '答案 [S1]' });
    await new ChatModelService(
      new ConfigService({ CHAT_MODEL_PROVIDER: 'ollama' }),
    ).generate('prompt');
    expect(vi.getTimerCount()).toBe(0);
  });
});
