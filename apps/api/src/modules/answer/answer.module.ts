import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { AnswerCitationService } from './answer-citation.service';
import { AnswerController } from './answer.controller';
import { AnswerPromptService } from './answer-prompt.service';
import { AnswerService } from './answer.service';
import { ChatModelService } from './chat-model.service';
import { AnswerGroundingService } from './answer-grounding.service';
import { ObservabilityModule } from '../observability/observability.module';
import { KnowledgeGraphModule } from '../graph/knowledge-graph.module';
import { AnswerRetrievalService } from './answer-retrieval.service';
import { GraphIntentService } from './graph-intent.service';

@Module({
  imports: [SearchModule, ObservabilityModule, KnowledgeGraphModule],
  controllers: [AnswerController],
  providers: [
    AnswerCitationService,
    AnswerPromptService,
    AnswerService,
    AnswerGroundingService,
    AnswerRetrievalService,
    GraphIntentService,
    ChatModelService,
    {
      provide: 'CHAT_MODEL_PROVIDER',
      useExisting: ChatModelService,
    },
  ],
  exports: [AnswerService],
})
export class AnswerModule {}
