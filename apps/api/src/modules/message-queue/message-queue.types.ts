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

export interface DocumentGraphDeleteMessage {
  type: 'DOCUMENT_GRAPH_DELETE';
  documentId: string;
}

export interface DocumentIndexDeleteMessage {
  type: 'DOCUMENT_INDEX_DELETE';
  documentId: string;
}

export interface DocumentSourceDeleteMessage {
  type: 'DOCUMENT_SOURCE_DELETE';
  documentId: string;
  storageKey: string;
}

export interface DocumentAssetsDeleteMessage {
  type: 'DOCUMENT_ASSETS_DELETE';
  documentId: string;
  keys: string[];
}

export type PipelineMessage =
  | { type: 'DOCUMENT_PARSE'; taskId: string }
  | DocumentIndexMessage
  | DocumentPipelineCommand
  | DocumentGraphDeleteMessage
  | DocumentIndexDeleteMessage
  | DocumentAssetsDeleteMessage
  | DocumentSourceDeleteMessage;

export type MessageHandler<T> = (message: T) => Promise<void>;
