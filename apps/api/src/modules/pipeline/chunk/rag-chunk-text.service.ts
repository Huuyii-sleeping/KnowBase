import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarkdownChunkerService } from './markdown-chunker.service';
import { retrievalContext, RetrievalContext } from './retrieval-context';
import { StructuredChunk } from './chunk.types';

export interface RagChunkText {
  content: string;
  retrievalText: string;
}

@Injectable()
export class RagChunkTextService {
  private readonly mode: RetrievalContext;
  constructor(
    private readonly chunker: MarkdownChunkerService,
    config: ConfigService,
  ) {
    this.mode = retrievalContext(
      config.get<string>('RAG_RETRIEVAL_CONTEXT', 'title-heading'),
    );
  }

  async prepare(markdown: string, title: string): Promise<RagChunkText[]> {
    return this.forChunks(
      await this.chunker.splitStructured(markdown),
      title,
    ).map(({ content, retrievalText }) => ({ content, retrievalText }));
  }

  // Consume persisted structure once; never split again or reconstruct source positions.
  forChunks<T extends StructuredChunk>(
    chunks: T[],
    title: string,
  ): Array<T & RagChunkText> {
    return chunks.map((chunk) => {
      if (this.mode === 'body')
        return { ...chunk, retrievalText: chunk.content };
      const headings = new Set(
        (chunk.content.match(/^(?:#{1,6} [^\n]+\n)+\n/)?.[0] ?? '')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => this.label(line.replace(/^#+ /, ''))),
      );
      const section =
        this.mode === 'title-heading'
          ? chunk.headingPath
              .map((heading) => this.label(heading))
              .filter((heading) => !headings.has(heading))
          : [];
      const documentTitle = this.label(title);
      const labels = [
        documentTitle &&
        !headings.has(documentTitle) &&
        !section.includes(documentTitle)
          ? `文档：${documentTitle}`
          : '',
        section.length ? `章节：${section.join(' > ')}` : '',
      ].filter(Boolean);
      return {
        ...chunk,
        retrievalText: [...labels, chunk.content].join('\n\n'),
      };
    });
  }

  private label(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 160);
  }
}
