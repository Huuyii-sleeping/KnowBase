import { Inject, Injectable } from '@nestjs/common';
import { AnswerCitation, AnswerCitationService } from './answer-citation.service';
import { AnswerPromptService } from './answer-prompt.service';
import { AnswerGroundingService } from './answer-grounding.service';
import { ChatModelProvider } from './chat-model.types';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { HybridSearchItem, HybridSearchService } from '../search/hybrid-search.service';
import { ObservabilityService } from '../observability/observability.service';
import { AuthUser } from '../auth/auth.types';

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
    private readonly observability: ObservabilityService,
  ) {}

  async answer(query: AnswerQuestionDto, user?: AuthUser): Promise<AnswerResult> {
    const question = query.question.trim();
    const trace = this.observability.startAnswerTrace(question, query.topK);
    try {
      const retrievalStartedAt = Date.now();
      const retrieval = await this.hybridSearch.search({
        query: question,
        topK: query.topK,
      }, user);
      const items = retrieval.items.filter((item) => item.content?.trim());
      this.observability.recordRetrieval(
        trace,
        { query: question, topK: query.topK },
        { itemCount: items.length, items: this.toTraceItems(items) },
        Date.now() - retrievalStartedAt,
      );

      const groundingStartedAt = Date.now();
      const groundedItems = this.grounding.selectSupportedItems(question, items);
      this.observability.recordGrounding(
        trace,
        { question, candidateCount: items.length },
        {
          selectedCount: groundedItems.length,
          selectedChunkIds: groundedItems.map((item) => item.chunkId ?? item.documentId),
        },
        Date.now() - groundingStartedAt,
      );

      const prompt = groundedItems.length ? this.prompt.build(question, groundedItems) : '';
      const generatedStartedAt = Date.now();
      const generated = groundedItems.length
        ? await this.chatModel.generate(prompt)
        : AnswerService.REFUSAL;
      if (groundedItems.length) {
        this.observability.recordGeneration(
          trace,
          { prompt, model: process.env.OLLAMA_CHAT_MODEL ?? 'qwen2.5:0.5b' },
          generated,
          Date.now() - generatedStartedAt,
        );
      }

      const answer = this.isRefusal(generated)
        ? AnswerService.REFUSAL
        : this.ensureCitationMarker(generated);
      const answerable = answer !== AnswerService.REFUSAL;
      const result = {
        question,
        answer: answer || AnswerService.REFUSAL,
        citations: answerable ? this.citations.build(answer, groundedItems) : [],
        contexts: answerable ? this.toContexts(groundedItems) : [],
      };
      this.observability.completeAnswer(trace, {
        answer: result.answer,
        citations: result.citations,
        contextCount: result.contexts.length,
      }, {
        status: answerable ? 'success' : 'refusal',
      });
      return result;
    } catch (error) {
      this.observability.failAnswer(trace, error);
      throw error;
    }
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

  private toTraceItems(items: HybridSearchItem[]) {
    return items.map((item) => ({
      documentId: item.documentId,
      chunkId: item.chunkId,
      title: item.title,
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
