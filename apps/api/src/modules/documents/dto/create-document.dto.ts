import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsString()
  uploaderId!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  team?: string;

  @IsOptional()
  @IsString()
  tags?: string;

  // 允许未来的解析服务把标准化 Markdown 直接传回文档模块。
  @IsOptional()
  @IsString()
  markdown?: string;
}
