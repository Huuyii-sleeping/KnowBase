import { Inject, Injectable } from '@nestjs/common';
import { HybridSearchItem } from '../search/hybrid-search.service';
import { ChatModelProvider } from './chat-model.types';
import { AnswerPromptService } from './answer-prompt.service';
import { ANSWER_REFUSAL } from './answer-citation-validation';
import { checkAnswerDeadline } from './answer-execution';
import { parseAnswerOutput } from './answer-output';
import {
  emitAnswerTelemetry,
  observeSyncStage,
} from '../observability/answer-telemetry';
import { withModelPurpose } from '../observability/model-call-telemetry';

@Injectable()
export class AnswerGenerationService {
  constructor(
    @Inject('CHAT_MODEL_PROVIDER') private readonly model: ChatModelProvider,
    private readonly prompts: AnswerPromptService,
  ) {}

  async generate(prompt: string, items: HybridSearchItem[]) {
    const attempts: Array<{
      prompt: string;
      output: string;
      latencyMs: number;
    }> = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      checkAnswerDeadline();
      const input = attempt === 0 ? prompt : this.prompts.repair(prompt);
      if (attempt === 1) emitAnswerTelemetry({ event: 'rag.answer.repair' });
      const started = Date.now();
      const output = await withModelPurpose(
        attempt === 0 ? 'initial' : 'citation_repair',
        () => this.model.generate(input),
      );
      checkAnswerDeadline();
      attempts.push({ prompt: input, output, latencyMs: Date.now() - started });
      const validated = observeSyncStage('citation.validate', () =>
        parseAnswerOutput(output, items),
      );
      if (validated)
        return {
          ...validated,
          modelName: this.model.modelName ?? 'unknown',
          attempts,
          outcome:
            validated.status === 'insufficient' ? 'refusal' : validated.status,
        };
    }
    // Missing/foreign citations must never be fabricated by attaching source S1.
    return {
      modelName: this.model.modelName ?? 'unknown',
      status: 'insufficient' as const,
      answer: ANSWER_REFUSAL,
      sourceIds: [],
      claims: [],
      attempts,
      outcome: 'invalid-evidence',
    };
  }
}
