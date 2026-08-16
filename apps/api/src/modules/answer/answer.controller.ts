import { Body, Controller, Post } from '@nestjs/common';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { AnswerService } from './answer.service';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';

@Controller('rag')
export class AnswerController {
  constructor(private readonly answerService: AnswerService) {}

  @Post('answer')
  answer(@Body() query: AnswerQuestionDto, @CurrentUser() user: AuthUser) {
    return this.answerService.answer(query, user);
  }
}
