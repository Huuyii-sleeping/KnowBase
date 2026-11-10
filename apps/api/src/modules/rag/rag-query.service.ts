import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

export type RecallRoute = 'keyword' | 'semantic';
export interface RecallTrace extends SemanticSearchResult {
  route: RecallRoute;
  rawCandidates: VectorChunkSearchItem[];
  elapsedMs: number;
}

@Injectable()
export class RagQueryService {
  constructor(
    private readonly embedding: EmbeddingService,
    private readonly vectorIndex: VectorIndexService,
    private readonly documentQuery: DocumentQueryService,
  ) {}

  async search(
    query: SemanticSearchDto,
    user?: AuthUser,
  ): Promise<SemanticSearchResult> {
    const {
      query: text,
      topK,
      items,
    } = await this.recall(query, 'semantic', user);
    return { query: text, topK, items };
  }

  async searchKeywordChunks(
    query: SemanticSearchDto,
    user?: AuthUser,
  ): Promise<SemanticSearchResult> {
    const {
      query: text,
      topK,
      items,
    } = await this.recall(query, 'keyword', user);
    return { query: text, topK, items };
  }

  /** Internal diagnostics; public controllers expose only the filtered items. */
  async recall(
    query: SemanticSearchDto,
    route: RecallRoute,
    user?: AuthUser,
  ): Promise<RecallTrace> {
    const started = performance.now();
    const normalizedQuery = query.query.trim();
    if (
      !normalizedQuery ||
      !Number.isInteger(query.topK) ||
      query.topK < 1 ||
      query.topK > 100
    )
      throw new BadRequestException(
        'recall requires a non-empty query and a candidate budget of 1..100',
      );
    const allowedDocumentIds = user
      ? await this.documentQuery.findVisiblePublishedIds(user)
      : undefined;
    if (allowedDocumentIds?.length === 0)
      return {
        query: normalizedQuery,
        topK: query.topK,
        items: [],
        rawCandidates: [],
        route,
        elapsedMs: performance.now() - started,
      };
    const input = {
      topK: Math.min(query.topK * 3, 100),
      allowedDocumentIds,
    };
    let candidates: VectorChunkSearchItem[];
    if (route === 'keyword') {
      candidates = await this.vectorIndex.searchKeywordChunks({
        ...input,
        query: normalizedQuery,
      });
    } else if (route === 'semantic') {
      const queryVector = await this.embedding.embedQuery(normalizedQuery);
      if (!queryVector?.length)
        throw new Error('embedding provider returned no query vector');
      candidates = await this.vectorIndex.searchChunks({
        ...input,
        queryVector,
      });
    } else {
      throw new BadRequestException('unsupported recall route');
    }
    return {
      query: normalizedQuery,
      topK: query.topK,
      items: await this.keepPublishedCandidates(candidates, query.topK),
      rawCandidates: candidates,
      route,
      elapsedMs: performance.now() - started,
    };
  }

  private async keepPublishedCandidates(
    candidates: VectorChunkSearchItem[],
    topK: number,
  ): Promise<SemanticSearchItem[]> {
    const items: SemanticSearchItem[] = [];
    const documents = new Map<
      string,
      Awaited<ReturnType<DocumentQueryService['findEntity']>> | null
    >();

    for (const candidate of candidates) {
      if (!documents.has(candidate.documentId)) {
        documents.set(
          candidate.documentId,
          await this.findPublishedDocument(candidate.documentId),
        );
      }
      const document = documents.get(candidate.documentId);
      if (!document || document.version !== candidate.version) {
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
