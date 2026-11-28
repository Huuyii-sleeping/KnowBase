import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatModelProvider } from './chat-model.types';
import { DeepSeekChatModelService } from './deepseek-chat-model.service';
import { OllamaChatModelService } from './ollama-chat-model.service';

@Injectable()
export class ChatModelService implements ChatModelProvider {
  readonly modelName: string;
  private readonly provider: DeepSeekChatModelService | OllamaChatModelService;

  constructor(config: ConfigService) {
    const provider = config
      .get<string>('CHAT_MODEL_PROVIDER', 'deepseek')
      .trim()
      .toLowerCase();
    if (provider === 'deepseek')
      this.provider = new DeepSeekChatModelService(config);
    else if (provider === 'ollama')
      this.provider = new OllamaChatModelService(config);
    else throw new Error('CHAT_MODEL_PROVIDER must be deepseek or ollama');
    this.modelName = this.provider.modelName;
  }

  generate(prompt: string): Promise<string> {
    return this.provider.generate(prompt);
  }
}
