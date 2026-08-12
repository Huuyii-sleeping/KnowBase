import { Injectable } from '@nestjs/common';
import { HybridSearchItem } from '../search/hybrid-search.service';

@Injectable()
export class AnswerPromptService {
  build(question: string, items: HybridSearchItem[]): string {
    const context = items.length
      ? items.map((item, index) => this.formatSource(item, index)).join('\n\n')
      : '没有检索到可用的知识库片段。';

    return [
      '你是企业知识库问答助手。',
      '请严格根据“知识库上下文”回答问题，不要使用上下文之外的事实。',
      '如果上下文无法支持答案，请直接回答“知识库中没有找到足够信息”，不要猜测或编造。',
      '如果无法回答，请只输出这句话，不要添加 [S1] 等引用标记。',
      '回答使用中文，最多输出三点，简洁、准确。每个关键结论后必须标注来源，例如 [S1]。不要扩展回答无关的概念。',
      '',
      `问题：${question}`,
      '',
      '知识库上下文：',
      context,
      '',
      '请输出最终回答，不要解释你的推理过程。',
    ].join('\n');
  }

  private formatSource(item: HybridSearchItem, index: number): string {
    const sourceId = `S${index + 1}`;
    const location = item.chunkIndex === undefined ? '' : `，Chunk ${item.chunkIndex}`;
    return [
      `[${sourceId}] 文档：${item.title}${location}`,
      `documentId=${item.documentId}`,
      item.content?.trim() || '该来源仅提供文档元数据。',
    ].join('\n');
  }
}
