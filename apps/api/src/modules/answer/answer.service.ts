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
  private static readonly REFUSAL = '知识库中没有找到足够信息';

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
    const groundedItems = this.grounding.selectSupportedItems(question, items);
    const generated = groundedItems.length
      ? await this.chatModel.generate(this.prompt.build(question, groundedItems))
      : AnswerService.REFUSAL;
    const answer = this.isRefusal(generated)
      ? AnswerService.REFUSAL
      : this.ensureCitationMarker(generated);
    const answerable = answer !== AnswerService.REFUSAL;

    return {
      question,
      answer: answer || AnswerService.REFUSAL,
      citations: answerable ? this.citations.build(answer, groundedItems) : [],
      contexts: answerable ? this.toContexts(groundedItems) : [],
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

  private isRefusal(answer: string): boolean {
    return answer
      .trim()
      .replace(/(?:\s*\[S\d+\])+\s*$/g, '')
      .trim()
      .replace(/[。！？.!?]+$/g, '')
      .trim() === AnswerService.REFUSAL;
  }
}
