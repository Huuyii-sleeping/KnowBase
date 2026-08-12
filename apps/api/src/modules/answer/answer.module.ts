import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { AnswerCitationService } from './answer-citation.service';
import { AnswerController } from './answer.controller';
import { AnswerPromptService } from './answer-prompt.service';
import { AnswerService } from './answer.service';
import { ChatModelService } from './chat-model.service';
import { AnswerGroundingService } from './answer-grounding.service';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [SearchModule, ObservabilityModule],
  controllers: [AnswerController],
  providers: [
    AnswerCitationService,
    AnswerPromptService,
    AnswerService,
    AnswerGroundingService,
    ChatModelService,
    {
      provide: 'CHAT_MODEL_PROVIDER',
      useExisting: ChatModelService,
    },
  ],
  exports: [AnswerService],
})
export class AnswerModule {}
