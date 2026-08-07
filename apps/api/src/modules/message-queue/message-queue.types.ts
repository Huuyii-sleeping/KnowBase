export interface DocumentIndexMessage {
  type: 'DOCUMENT_INDEX';
  documentId: string;
  version: number;
  metadata: Record<string, unknown>;
  markdown: string;
}

export interface DocumentPipelineCommand {
  type: 'DOCUMENT_PIPELINE_COMMAND';
  documentId: string;
  version: number;
}

export type PipelineMessage =
  | DocumentIndexMessage
  | DocumentPipelineCommand;

export type MessageHandler<T> = (message: T) => Promise<void>;
