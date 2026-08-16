import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentQueryService } from '../documents/document-query.service';
import { DocumentStatus } from '../documents/entities/document.entity';
import { EmbeddingService } from '../pipeline/embedding/embedding.service';
import {
  VectorChunkSearchItem,
  VectorIndexService,
} from '../pipeline/vector-index/vector-index.service';
import { SemanticSearchDto } from './dto/semantic-search.dto';
import { AuthUser } from '../auth/auth.types';

export interface SemanticSearchItem {
  chunkId: string;
  documentId: string;
  documentVersion: number;
  chunkIndex: number;
  content: string;
  score: number | null;
  document: {
    title: string;
    category: string | null;
    team: string | null;
    tags: string[];
  };
}

export interface SemanticSearchResult {
  query: string;
  topK: number;
  items: SemanticSearchItem[];
}

@Injectable()
export class RagQueryService {
  constructor(
    private readonly embedding: EmbeddingService,
    private readonly vectorIndex: VectorIndexService,
    private readonly documentQuery: DocumentQueryService,
  ) {}

  async search(query: SemanticSearchDto, user?: AuthUser): Promise<SemanticSearchResult> {
    const normalizedQuery = query.query.trim();
    const [queryVector] = await this.embedding.embedDocuments([normalizedQuery]);
    if (!queryVector) {
      throw new Error('embedding provider returned no query vector');
    }

    const candidates = await this.vectorIndex.searchChunks({
      queryVector,
      topK: Math.min(query.topK * 3, 100),
      allowedDocumentIds: user
        ? await this.documentQuery.findVisiblePublishedIds(user)
        : undefined,
    });
    const items = await this.keepPublishedCandidates(candidates, query.topK);

    return {
      query: normalizedQuery,
      topK: query.topK,
      items,
    };
  }

  private async keepPublishedCandidates(
    candidates: VectorChunkSearchItem[],
    topK: number,
  ): Promise<SemanticSearchItem[]> {
    const items: SemanticSearchItem[] = [];
    const documents = new Map<string, Awaited<ReturnType<DocumentQueryService['findEntity']>> | null>();

    for (const candidate of candidates) {
      if (!documents.has(candidate.documentId)) {
        documents.set(candidate.documentId, await this.findPublishedDocument(candidate.documentId));
      }
      const document = documents.get(candidate.documentId);
      if (!document) {
        continue;
      }

      items.push({
        chunkId: candidate.id,
        documentId: candidate.documentId,
        documentVersion: candidate.version,
        chunkIndex: candidate.chunkIndex,
        content: candidate.content,
        score: candidate.score,
        document: {
          title: document.title,
          category: document.category,
          team: document.team,
          tags: document.tags,
        },
      });
      if (items.length >= topK) {
        break;
      }
    }

    return items;
  }

  private async findPublishedDocument(documentId: string) {
    try {
      const document = await this.documentQuery.findEntity(documentId);
      return document.status === DocumentStatus.PUBLISHED ? document : null;
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }
}
