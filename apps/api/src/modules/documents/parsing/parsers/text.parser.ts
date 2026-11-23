import { Injectable } from '@nestjs/common';
import {
  FormatParser,
  FileParserContext,
  ParsedDocument,
} from '../file-parser.types';
import { titleFromFileName } from '../parser.utils';
import { decodeText } from './decode-text';

@Injectable()
export class TextParser implements FormatParser {
  async parse(
    buffer: Buffer,
    fileName: string,
    _context: FileParserContext,
  ): Promise<ParsedDocument> {
    return {
      markdown: `# ${titleFromFileName(fileName)}\n\n${decodeText(buffer)}\n`,
      assets: [],
      ready: true,
      parser: 'text',
      warnings: [],
    };
  }
}
