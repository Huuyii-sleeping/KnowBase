import { Body, Controller, Post } from '@nestjs/common';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { AnswerService } from './answer.service';

@Controller('rag')
export class AnswerController {
  constructor(private readonly answerService: AnswerService) {}

  @Post('answer')
  answer(@Body() query: AnswerQuestionDto) {
    return this.answerService.answer(query);
  }
}
