import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import {
  ANSWER_MODEL_MAX_OUTPUT_TOKENS,
  ANSWER_MODEL_TIMEOUT_MS,
} from './answer-budget';
import { invokeAnswerModel } from './chat-model-invocation';
import { ChatModelProvider } from './chat-model.types';

export class DeepSeekChatModelService implements ChatModelProvider {
  readonly modelName: string;
  private readonly model: ChatOpenAI;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('DEEPSEEK_API_KEY')?.trim();
    if (!apiKey)
      throw new Error(
        'DEEPSEEK_API_KEY is required for the DeepSeek answer provider',
      );
    this.modelName = config
      .get<string>('DEEPSEEK_MODEL', 'deepseek-v4-pro')
      .trim();
    if (!this.modelName) throw new Error('DEEPSEEK_MODEL must not be empty');
    const baseURL = config
      .get<string>('DEEPSEEK_BASE_URL', 'https://api.deepseek.com')
      .trim();
    let url: URL;
    try {
      url = new URL(baseURL);
    } catch {
      throw new Error('DEEPSEEK_BASE_URL must be an HTTP(S) URL');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'DEEPSEEK_BASE_URL must be an HTTP(S) URL without credentials, query or fragment',
      );
    this.model = new ChatOpenAI({
      apiKey,
      model: this.modelName,
      configuration: { baseURL: baseURL.replace(/\/+$/, '') },
      useResponsesApi: false,
      streaming: false,
      temperature: 0,
      maxTokens: ANSWER_MODEL_MAX_OUTPUT_TOKENS,
      timeout: ANSWER_MODEL_TIMEOUT_MS,
      maxRetries: 0,
      // Keep a final-answer budget, rather than spending it on hidden thinking.
      // Thinking mode needs its own measured latency and output budget.
      modelKwargs: { thinking: { type: 'disabled' } },
    });
  }

  generate(prompt: string): Promise<string> {
    return invokeAnswerModel((signal) => this.model.invoke(prompt, { signal }));
  }
}
