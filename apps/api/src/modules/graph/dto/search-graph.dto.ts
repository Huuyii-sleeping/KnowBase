import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class SearchGraphDto {
  @IsString()
  @IsNotEmpty()
  query!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  maxHops = 2;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
