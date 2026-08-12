import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOllama } from '@langchain/ollama';
import { ChatModelProvider } from './chat-model.types';

@Injectable()
export class ChatModelService implements ChatModelProvider {
  private readonly model: ChatOllama;

  constructor(config: ConfigService) {
    this.model = new ChatOllama({
      baseUrl: config.get<string>('OLLAMA_BASE_URL', 'http://localhost:11434'),
      model: config.get<string>('OLLAMA_CHAT_MODEL', 'qwen2.5:0.5b'),
      temperature: Number(config.get<string>('OLLAMA_CHAT_TEMPERATURE', '0')),
      seed: Number(config.get<string>('OLLAMA_CHAT_SEED', '42')),
    });
  }

  async generate(prompt: string): Promise<string> {
    const response = await this.model.invoke(prompt);
    return this.toText(response.content);
  }

  private toText(content: unknown): string {
    if (typeof content === 'string') {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as { text: unknown }).text);
          }
          return '';
        })
        .join('')
        .trim();
    }
    return content ? String(content).trim() : '';
  }
}
