import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

@Injectable()
export class MarkdownChunkerService {
  private readonly splitter: RecursiveCharacterTextSplitter;

  constructor(config: ConfigService) {
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize: Number(config.get<string | number>('RAG_CHUNK_SIZE', 1000)),
      chunkOverlap: Number(
        config.get<string | number>('RAG_CHUNK_OVERLAP', 150),
      ),
      separators: ['\n# ', '\n## ', '\n### ', '\n\n', '\n', ' ', ''],
    });
  }

  async split(markdown: string): Promise<string[]> {
    const chunks = await this.splitter.splitText(markdown);
    return chunks.map((chunk) => chunk.trim()).filter(Boolean);
  }
}
