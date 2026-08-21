import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOllama } from '@langchain/ollama';
import {
  GraphExtractionProvider,
  GraphExtractionParseError,
  RawGraphExtraction,
} from './graph-extractor.types';

const EXTRACTION_PROMPT = `你是企业知识图谱抽取器。请从下面的 Markdown 文本中抽取明确出现的实体和实体之间的关系。

只输出 JSON，不要输出 Markdown 代码块、解释或其他文字，格式必须是：
{"entities":[{"name":"实体名称","type":"实体类型"}],"relations":[{"source":"源实体名称","target":"目标实体名称","type":"关系类型"}]}

要求：
1. 只抽取原文明确提到的信息，不要推测。
2. 实体名称使用原文中的完整名称，实体类型使用简短中文名，例如“人”“组织”“产品”“技术”“地点”。
3. relation 的 source 和 target 必须与 entities 中的 name 完全一致。
4. 没有实体或关系时返回空数组。

Markdown 文本：
`;

@Injectable()
export class OllamaGraphExtractorService implements GraphExtractionProvider {
  private readonly model: ChatOllama;

  constructor(config: ConfigService) {
    this.model = new ChatOllama({
      baseUrl: config.get<string>('OLLAMA_BASE_URL', 'http://localhost:11434'),
      model: config.get<string>('OLLAMA_KG_MODEL', 'qwen2.5:0.5b'),
      temperature: Number(config.get<string>('OLLAMA_KG_TEMPERATURE', '0')),
      seed: Number(config.get<string>('OLLAMA_KG_SEED', '42')),
    });
  }

  async extract(markdownChunk: string): Promise<RawGraphExtraction> {
    const response = await this.model.invoke(`${EXTRACTION_PROMPT}${markdownChunk}`);
    return this.parseResponse(this.toText(response.content));
  }

  private parseResponse(text: string): RawGraphExtraction {
    const json = this.extractJson(text);
    if (!json) {
      throw new GraphExtractionParseError('graph extraction response did not contain a JSON object');
    }

    try {
      const parsed = JSON.parse(json) as {
        entities?: unknown;
        relations?: unknown;
      };
      return {
        entities: this.parseEntities(parsed.entities),
        relations: this.parseRelations(parsed.relations),
      };
    } catch (error) {
      if (error instanceof GraphExtractionParseError) throw error;
      throw new GraphExtractionParseError('graph extraction response contained malformed JSON');
    }
  }

  private parseEntities(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((entity): entity is Record<string, unknown> => Boolean(entity) && typeof entity === 'object')
      .map((entity) => ({
        name: this.clean(entity.name),
        type: this.clean(entity.type) || '未知',
      }))
      .filter((entity) => entity.name);
  }

  private parseRelations(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((relation): relation is Record<string, unknown> => Boolean(relation) && typeof relation === 'object')
      .map((relation) => ({
        source: this.clean(relation.source),
        target: this.clean(relation.target),
        type: this.clean(relation.type) || '相关',
      }))
      .filter((relation) => relation.source && relation.target && relation.source !== relation.target);
  }

  private extractJson(text: string): string | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    return start >= 0 && end > start ? text.slice(start, end + 1) : null;
  }

  private clean(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, 255) : '';
  }

  private toText(content: unknown): string {
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') return part;
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
