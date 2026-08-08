import { Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class HybridSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  query!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  topK = 5;
}
