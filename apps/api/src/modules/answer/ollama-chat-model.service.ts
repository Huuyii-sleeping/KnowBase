import { ConfigService } from '@nestjs/config';
import { ChatOllama } from '@langchain/ollama';
import {
  ANSWER_MODEL_CONTEXT_TOKENS,
  ANSWER_MODEL_MAX_OUTPUT_TOKENS,
} from './answer-budget';
import { invokeAnswerModel } from './chat-model-invocation';
import { ChatModelProvider } from './chat-model.types';

export class OllamaChatModelService implements ChatModelProvider {
  readonly modelName: string;
  private readonly model: ChatOllama;

  constructor(config: ConfigService) {
    this.modelName = config.get<string>('OLLAMA_CHAT_MODEL', 'qwen2.5:7b');
    this.model = new ChatOllama({
      baseUrl: config.get<string>('OLLAMA_BASE_URL', 'http://localhost:11434'),
      model: this.modelName,
      temperature: Number(config.get<string>('OLLAMA_CHAT_TEMPERATURE', '0')),
      seed: Number(config.get<string>('OLLAMA_CHAT_SEED', '42')),
      numCtx: ANSWER_MODEL_CONTEXT_TOKENS,
      numPredict: ANSWER_MODEL_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
    });
  }

  generate(prompt: string): Promise<string> {
    return invokeAnswerModel(
      (signal) => this.model.invoke(prompt, { signal }),
      this.modelName,
    );
  }
}
