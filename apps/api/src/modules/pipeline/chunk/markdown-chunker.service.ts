import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { markdownBlocks } from '../../ingestion/markdown-blocks';
import { SourceSection } from '../../ingestion/document-structure';
import { integerOption } from '../../ingestion/numeric-option';
import { structuredChunks, CHUNK_STRATEGY } from './structured-chunks';
import { ChunkOptions, StructuredChunk } from './chunk.types';

@Injectable()
export class MarkdownChunkerService {
  readonly options: ChunkOptions;
  readonly strategy: string;

  constructor(config: ConfigService) {
    this.options = {
      size: integerOption(config, 'RAG_CHUNK_SIZE', 1000, 16),
      overlap: integerOption(config, 'RAG_CHUNK_OVERLAP', 150, 0),
    };
    if (this.options.overlap >= this.options.size)
      throw new Error('RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE');
    this.strategy = `${CHUNK_STRATEGY}:${this.options.size}:${this.options.overlap}`;
  }

  splitStructured(
    markdown: string,
    sections?: SourceSection[],
  ): Promise<StructuredChunk[]> {
    return structuredChunks(markdownBlocks(markdown, sections), this.options);
  }

  async split(markdown: string): Promise<string[]> {
    return (await this.splitStructured(markdown)).map((chunk) => chunk.content);
  }
}
