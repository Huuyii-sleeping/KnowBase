import { IsString, MaxLength } from 'class-validator';
import { CreateDocumentDto } from './create-document.dto';
export class ImportWebDto extends CreateDocumentDto {
  @IsString() @MaxLength(4096) url!: string;
}
