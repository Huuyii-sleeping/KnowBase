export interface ParsedAsset {
  type: 'image' | 'attachment';
  objectKey: string;
  url: string;
  alt?: string;
  contentType?: string;
}

export interface ParsedDocument {
  markdown: string;
  assets: ParsedAsset[];
  ready: boolean;
  parser: string;
  warnings: string[];
  error?: string;
}

export interface AssetUploadInput {
  fileName: string;
  data: Buffer;
  contentType: string;
  type?: ParsedAsset['type'];
  alt?: string;
}

export interface FileParserContext {
  documentId: string;
  uploadAsset(input: AssetUploadInput): Promise<ParsedAsset>;
}

export interface FormatParser {
  parse(buffer: Buffer, fileName: string, context: FileParserContext): Promise<ParsedDocument>;
}
