import { Body, Controller, Post, Res, UseFilters } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Response } from 'express';
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
  answer(
    @Body() query: AnswerQuestionDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);
    return this.answerService.answer(query, user, requestId);
  }
}
