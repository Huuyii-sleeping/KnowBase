import { IsNotEmpty, IsString } from 'class-validator';

export class PublishDocumentDto {
  @IsString()
  @IsNotEmpty()
  reviewerId!: string;
}
