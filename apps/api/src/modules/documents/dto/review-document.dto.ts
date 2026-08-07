import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ReviewDocumentDto {
  @IsBoolean()
  approved!: boolean;

  @IsString()
  reviewerId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
