import { Injectable } from '@nestjs/common';
import {
  AnswerCitation,
  AnswerCitationService,
} from './answer-citation.service';
import { AnswerContextService } from './answer-context.service';
import { AnswerGenerationService } from './answer-generation.service';
import { ANSWER_REFUSAL } from './answer-citation-validation';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import {
  HybridSearchItem,
  HybridSearchSource,
} from '../search/hybrid-search.service';
import { ObservabilityService } from '../observability/observability.service';
import { AuthUser } from '../auth/auth.types';
import { AnswerRetrievalService } from './answer-retrieval.service';
import {
  AnswerExecution,
  checkAnswerDeadline,
  runWithAnswerDeadline,
} from './answer-execution';
import { AnswerStatus } from './answer-output';
import { AnswerContentRange, AnswerContextItem } from './answer-context.types';

export interface AnswerResult {
  question: string;
  status: AnswerStatus;
  answer: string;
  citations: AnswerCitation[];
  contexts: Array<{
    sourceId: string;
    documentId: string;
    chunkId?: string;
    title: string;
    content?: string;
    score: number;
    sourceType: HybridSearchSource;
    contentRange?: AnswerContentRange;
  }>;
}

@Injectable()
export class AnswerService {
  constructor(
    private readonly retrieval: AnswerRetrievalService,
    private readonly context: AnswerContextService,
    private readonly generation: AnswerGenerationService,
    private readonly citations: AnswerCitationService,
    private readonly observability: ObservabilityService,
  ) {}

  async answer(
    query: AnswerQuestionDto,
    user?: AuthUser,
  ): Promise<AnswerResult> {
    const question = query.question.trim();
    const trace = this.observability.startAnswerTrace(question, query.topK);
    let execution: AnswerExecution | undefined;
    try {
      return await runWithAnswerDeadline(async (activeExecution) => {
        execution = activeExecution;
        const retrievalStartedAt = Date.now();
        const retrieval = await this.retrieval.retrieve(
          question,
          query.topK,
          user,
        );
        checkAnswerDeadline();
        const items = retrieval.items.filter((item) => item.content?.trim());
        this.observability.recordRetrieval(
          trace,
          { query: question, topK: query.topK },
          {
            itemCount: items.length,
            items: this.toTraceItems(items),
            graphUsed: retrieval.graphUsed,
          },
          Date.now() - retrievalStartedAt,
        );

        activeExecution.stage = 'context';
        const groundingStartedAt = Date.now();
        const context = this.context.build(question, items);
        const groundedItems = context.items;
        this.observability.recordGrounding(
          trace,
          { question, candidateCount: items.length },
          {
            selectedCount: groundedItems.length,
            promptBytes: context.promptBytes,
            selectionPolicy: context.selectionPolicy,
            omittedCount: context.omittedCount,
            selectedChunkIds: groundedItems.map(
              (item) => item.chunkId ?? item.documentId,
            ),
          },
          Date.now() - groundingStartedAt,
        );

        checkAnswerDeadline();
        activeExecution.stage = 'generation';
        const generated = groundedItems.length
          ? await this.generation.generate(context.prompt, groundedItems)
          : {
              modelName: 'none',
              status: 'insufficient' as const,
              answer: ANSWER_REFUSAL,
              sourceIds: [],
              claims: [],
              attempts: [],
              outcome: 'no-context',
            };
        checkAnswerDeadline();
        for (const attempt of generated.attempts) {
          this.observability.recordGeneration(
            trace,
            {
              prompt: attempt.prompt,
              model: generated.modelName,
            },
            attempt.output,
            attempt.latencyMs,
          );
        }
        activeExecution.stage = 'citation';
        const answer = generated.answer;
        const answerable = generated.status === 'answered';
        const result = {
          question,
          status: generated.status,
          answer: answer,
          citations: answerable
            ? this.citations.build(answer, groundedItems, generated.claims)
            : [],
          contexts: answerable ? this.toContexts(groundedItems) : [],
        };
        checkAnswerDeadline();
        this.observability.completeAnswer(
          trace,
          {
            answer: result.answer,
            citations: result.citations,
            contextCount: result.contexts.length,
          },
          {
            status: answerable ? 'success' : 'refusal',
            outcome: generated.outcome,
            generationAttempts: generated.attempts.length,
            modelCalls: activeExecution.modelCalls,
            transportRetries: activeExecution.transportRetries,
            recoveredFailureCode: activeExecution.lastFailureCode,
          },
        );
        return result;
      });
    } catch (error) {
      this.observability.failAnswer(trace, error, {
        stage: execution?.stage,
        modelCalls: execution?.modelCalls ?? 0,
        transportRetries: execution?.transportRetries ?? 0,
      });
      throw error;
    }
  }

  private toContexts(items: AnswerContextItem[]) {
    return items.map((item, index) => ({
      sourceId: `S${index + 1}`,
      documentId: item.documentId,
      chunkId: item.chunkId,
      title: item.title,
      content: item.content,
      ...(item.contentRange ? { contentRange: item.contentRange } : {}),
      score: item.rerankScore,
      sourceType: item.sources.includes('graph')
        ? 'graph'
        : (item.sources[0] ?? 'semantic'),
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
}
