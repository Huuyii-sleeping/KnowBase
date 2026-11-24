import { Body, Controller, Post, UseFilters } from '@nestjs/common';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { AnswerService } from './answer.service';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AnswerFailureFilter } from './answer-failure.filter';
import { AuthUser } from '../auth/auth.types';

@UseFilters(AnswerFailureFilter)
@Controller('rag')
export class AnswerController {
  constructor(private readonly answerService: AnswerService) {}

  @Post('answer')
  answer(@Body() query: AnswerQuestionDto, @CurrentUser() user: AuthUser) {
    return this.answerService.answer(query, user);
  }
}
