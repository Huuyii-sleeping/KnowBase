import { SourceLocation } from '../../ingestion/document-structure';

export interface ChunkRange {
  // A source block range; generated headings, repeated headers and fences have no raw offset.
  start: number;
  end: number;
  source?: SourceLocation;
}

export interface StructuredChunk {
  content: string;
  embeddingText: string;
  headingPath: string[];
  ranges: ChunkRange[];
  contentHash: string;
  strategy: string;
}

export interface ChunkOptions {
  size: number;
  overlap: number;
}
