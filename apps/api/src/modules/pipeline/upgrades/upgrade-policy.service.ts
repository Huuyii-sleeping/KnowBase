import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { MarkdownChunkerService } from '../chunk/markdown-chunker.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { OllamaGraphExtractorService } from '../kg/ollama-graph-extractor.service';
import { UpgradeTarget } from './upgrade.types';
export const upgradeHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class UpgradePolicyService {
  constructor(
    private readonly config: ConfigService,
    private readonly chunks: MarkdownChunkerService,
    private readonly embeddings: EmbeddingService,
    private readonly graph: OllamaGraphExtractorService,
  ) {}
  snapshot(): { target: UpgradeTarget; hash: string } {
    if (!this.embeddings.fingerprint || !this.graph.fingerprint)
      throw new ConflictException('UPGRADE_MODEL_REVISION_REQUIRED');
    // Endpoints may contain credentials. Only fingerprints leave this service.
    const target: UpgradeTarget = {
      protocol: 'index-upgrade-v1',
      chunkStrategy: this.chunks.strategy,
      embeddingFingerprint: this.embeddings.fingerprint,
      graphFingerprint: this.graph.fingerprint,
      indexFingerprint: upgradeHash([
        this.config.get('ELASTICSEARCH_NODE', 'http://localhost:19200'),
        this.config.get('ELASTICSEARCH_DOCUMENT_INDEX', 'kh_document'),
        this.config.get('ELASTICSEARCH_CHUNK_INDEX', 'kh_chunk'),
        this.config.get('NEO4J_URI', 'bolt://localhost:17687'),
        'generation-schema-v1',
      ]),
      budgetFingerprint: upgradeHash(
        [
          this.config.get('RAG_EMBEDDING_MAX_TOKENS', null),
          this.config.get('RAG_EMBEDDING_BATCH_SIZE', 32),
          this.config.get('RAG_EMBEDDING_BATCH_CHARACTERS', 24000),
          this.config.get('RAG_EMBEDDING_CONCURRENCY', 2),
          this.config.get('RAG_EMBEDDING_TIMEOUT_MS', 60000),
        ].map(String),
      ),
    };
    return { target, hash: upgradeHash(target) };
  }
  matches(hash: string): boolean {
    try {
      return this.snapshot().hash === hash;
    } catch {
      return false;
    }
  }
}
