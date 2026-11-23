import { Injectable } from '@nestjs/common';
import {
  FormatParser,
  FileParserContext,
  ParsedDocument,
} from '../file-parser.types';
import { decodeText } from './decode-text';

@Injectable()
export class MarkdownParser implements FormatParser {
  async parse(
    buffer: Buffer,
    _fileName: string,
    _context: FileParserContext,
  ): Promise<ParsedDocument> {
    return {
      markdown: `${decodeText(buffer)}\n`,
      assets: [],
      ready: true,
      parser: 'markdown',
      warnings: [],
    };
  }
}
