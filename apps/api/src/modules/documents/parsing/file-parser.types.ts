import {
  DocumentBlock,
  SourceSection,
} from '../../ingestion/document-structure';

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
  sections?: SourceSection[];
  blocks?: DocumentBlock[];
  parseStrategy?: string;
  quality?: ParseQuality;
  provenance?: Record<string, string>;
}

export interface ParseQuality {
  status: 'accepted' | 'needs_review' | 'failed';
  issues: Array<{ code: string; message: string; page?: number }>;
}

export interface ParseExecution {
  signal?: AbortSignal;
  remoteTaskId?: string;
  onRemoteTask?: (taskId: string) => Promise<void>;
  onStage?: (stage: string) => Promise<void>;
  onAsset?: (asset: ParsedAsset) => Promise<void>;
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
  execution?: ParseExecution;
  uploadAsset(input: AssetUploadInput): Promise<ParsedAsset>;
}

export interface FormatParser {
  parse(
    buffer: Buffer,
    fileName: string,
    context: FileParserContext,
  ): Promise<ParsedDocument>;
}
