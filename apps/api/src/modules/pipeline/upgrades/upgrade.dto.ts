import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { DocumentStatus } from '../../documents/entities/document.entity';
export class CreateUpgradeDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  documentIds?: string[];
  @IsOptional() @IsEnum(DocumentStatus) status?: DocumentStatus;
  @IsOptional() @IsInt() @Min(100) @Max(3600000) intervalMs?: number;
}
export class UpgradePageDto {
  @IsOptional() @IsUUID('4') after?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}
