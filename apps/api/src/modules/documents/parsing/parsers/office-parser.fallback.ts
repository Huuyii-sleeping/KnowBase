import { Injectable } from '@nestjs/common';
import officeParser from 'officeparser';
import { extname } from 'node:path';
import { errorMessage } from '../parser.utils';
import { FileParserContext, ParsedDocument } from '../file-parser.types';

@Injectable()
export class OfficeParserFallback {
  async parse(
    buffer: Buffer,
    fileName: string,
    _context: FileParserContext,
    primaryError: unknown,
  ): Promise<ParsedDocument> {
    const parser = officeParser as any;
    const ast = await parser.parseOffice(buffer, {
      fileType: extname(fileName).slice(1),
      extractAttachments: true,
    });
    const result = typeof ast.to === 'function' ? await ast.to('md') : await ast.toMarkdown?.();
    const markdown = typeof result === 'string' ? result : result?.value;
    if (!markdown) {
      throw new Error('officeparser produced no Markdown output');
    }

    return {
      markdown: `${markdown.trim()}\n`,
      assets: [],
      ready: true,
      parser: 'officeparser-fallback',
      warnings: [`Primary parser failed: ${errorMessage(primaryError)}`],
    };
  }
}
