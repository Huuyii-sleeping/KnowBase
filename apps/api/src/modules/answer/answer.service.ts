import { Inject, Injectable } from '@nestjs/common';
import { AnswerCitation, AnswerCitationService } from './answer-citation.service';
import { AnswerPromptService } from './answer-prompt.service';
import { AnswerGroundingService } from './answer-grounding.service';
import { ChatModelProvider } from './chat-model.types';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { HybridSearchItem, HybridSearchService } from '../search/hybrid-search.service';

export interface AnswerResult {
  question: string;
  answer: string;
  citations: AnswerCitation[];
  contexts: Array<{
    sourceId: string;
    documentId: string;
    chunkId?: string;
    title: string;
    content?: string;
    score: number;
  }>;
}

@Injectable()
export class AnswerService {
  constructor(
    private readonly hybridSearch: HybridSearchService,
    private readonly prompt: AnswerPromptService,
    @Inject('CHAT_MODEL_PROVIDER')
    private readonly chatModel: ChatModelProvider,
    private readonly citations: AnswerCitationService,
    private readonly grounding: AnswerGroundingService,
  ) {}

  async answer(query: AnswerQuestionDto): Promise<AnswerResult> {
    const question = query.question.trim();
    const retrieval = await this.hybridSearch.search({
      query: question,
      topK: query.topK,
    });
    const items = retrieval.items.filter((item) => item.content?.trim());
    const groundedItems = this.grounding.hasLexicalSupport(question, items) ? items : [];
    const generated = groundedItems.length
      ? await this.chatModel.generate(this.prompt.build(question, groundedItems))
      : '知识库中没有找到足够信息';
    const answer = groundedItems.length
      ? this.ensureCitationMarker(generated)
      : generated;

    return {
      question,
      answer: answer || '知识库中没有找到足够信息',
      citations: this.citations.build(answer, groundedItems),
      contexts: this.toContexts(groundedItems),
    };
  }

  private toContexts(items: HybridSearchItem[]) {
    return items.map((item, index) => ({
      sourceId: `S${index + 1}`,
      documentId: item.documentId,
      chunkId: item.chunkId,
      title: item.title,
      content: item.content,
      score: item.rerankScore,
    }));
  }

  private ensureCitationMarker(answer: string): string {
    const normalized = answer.trim();
    return normalized && !/\[S\d+\]/.test(normalized)
      ? `${normalized} [S1]`
      : normalized;
  }
}
