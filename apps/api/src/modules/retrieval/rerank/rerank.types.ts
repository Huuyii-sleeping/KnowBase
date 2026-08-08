export interface RerankableCandidate {
  documentId: string;
  chunkId?: string;
  title: string;
  content?: string;
  category: string | null;
  team: string | null;
  tags: string[];
  score: number;
  keywordScore: number | null;
  semanticScore: number | null;
  sources: Array<'keyword' | 'semantic'>;
}

export interface RerankOptions {
  topK: number;
  maxChunksPerDocument?: number;
  maxContextCharacters?: number;
}
