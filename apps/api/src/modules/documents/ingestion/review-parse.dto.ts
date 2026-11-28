import {
  IsBoolean,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ReviewParseDto {
  @IsUUID() taskId!: string;
  @IsBoolean() accept!: boolean;
  @IsBoolean() acknowledgeIssues!: boolean;
  @IsString() @MinLength(3) @MaxLength(2000) note!: string;
}
