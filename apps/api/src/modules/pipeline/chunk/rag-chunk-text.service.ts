import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarkdownChunkerService } from './markdown-chunker.service';
import { headingPathAt, markdownHeadings } from './markdown-headings';
import { retrievalContext, RetrievalContext } from './retrieval-context';

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
      config.get<string>('RAG_RETRIEVAL_CONTEXT', 'body'),
    );
  }

  async prepare(markdown: string, title: string): Promise<RagChunkText[]> {
    if (this.mode === 'body')
      return (await this.chunker.split(markdown)).map((content) => ({
        content,
        retrievalText: content,
      }));
    const headings =
      this.mode === 'title-heading' ? markdownHeadings(markdown) : [];
    const chunks = await this.chunker.splitLocated(markdown);
    // Context only assists indexing/embedding. Citations and grading use content.
    return chunks.map(({ content, startLine }) => {
      const section = headingPathAt(headings, startLine);
      const labels = [
        title.trim() ? `文档：${this.label(title)}` : '',
        section.length
          ? `章节：${section.map((s) => this.label(s)).join(' > ')}`
          : '',
      ].filter(Boolean);
      return {
        content,
        retrievalText: [...labels, content].join('\n\n'),
      };
    });
  }

  private label(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 160);
  }
}
