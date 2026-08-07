import { Injectable } from '@nestjs/common';
import { FormatParser, FileParserContext, ParsedDocument } from '../file-parser.types';
import { titleFromFileName } from '../parser.utils';

@Injectable()
export class TextParser implements FormatParser {
  async parse(buffer: Buffer, fileName: string, _context: FileParserContext): Promise<ParsedDocument> {
    return {
      markdown: `# ${titleFromFileName(fileName)}\n\n${buffer.toString('utf8').trim()}\n`,
      assets: [],
      ready: true,
      parser: 'text',
      warnings: [],
    };
  }
}
