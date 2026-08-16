import { IsOptional } from 'class-validator';

export class PublishDocumentDto {
  @IsOptional()
  noop?: never;
}
