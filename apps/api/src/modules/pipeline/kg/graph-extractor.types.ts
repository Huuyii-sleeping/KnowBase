export interface GraphExtractionEntity {
  name: string;
  type: string;
}

export interface GraphExtractionRelation {
  source: string;
  target: string;
  type: string;
}

export interface RawGraphExtraction {
  entities: GraphExtractionEntity[];
  relations: GraphExtractionRelation[];
}

export interface GraphExtractionResult {
  entities: Array<GraphExtractionEntity & { key: string }>;
  mentions: Array<{ chunkId: string; entityKey: string }>;
  relations: Array<GraphExtractionRelation & {
    key: string;
    sourceKey: string;
    targetKey: string;
    chunkId: string;
  }>;
}

export interface GraphExtractionProvider {
  extract(markdownChunk: string): Promise<RawGraphExtraction>;
}

export class GraphExtractionParseError extends Error {
  constructor(message = 'graph extraction model returned invalid JSON') {
    super(message);
    this.name = 'GraphExtractionParseError';
  }
}
