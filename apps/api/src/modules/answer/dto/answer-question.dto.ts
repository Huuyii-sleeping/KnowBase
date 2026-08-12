import { Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AnswerQuestionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  question!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  topK = 5;
}
