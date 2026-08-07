import { Injectable } from '@nestjs/common';
import { FormatParser, FileParserContext, ParsedDocument } from '../file-parser.types';

@Injectable()
export class MarkdownParser implements FormatParser {
  async parse(buffer: Buffer, _fileName: string, _context: FileParserContext): Promise<ParsedDocument> {
    return {
      markdown: `${buffer.toString('utf8').trim()}\n`,
      assets: [],
      ready: true,
      parser: 'markdown',
      warnings: [],
    };
  }
}
