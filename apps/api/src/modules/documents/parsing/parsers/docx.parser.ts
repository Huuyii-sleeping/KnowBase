import { Injectable } from '@nestjs/common';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { extensionFromMime, titleFromFileName } from '../parser.utils';
import {
  FileParserContext,
  FormatParser,
  ParsedDocument,
  ParsedAsset,
} from '../file-parser.types';
import { tableToMarkdown } from '../markdown-table.util';

@Injectable()
export class DocxParser implements FormatParser {
  async parse(
    buffer: Buffer,
    fileName: string,
    context: FileParserContext,
  ): Promise<ParsedDocument> {
    const assets: ParsedAsset[] = [];
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement(async (image: any) => {
          const base64 = await image.read('base64');
          const asset = await context.uploadAsset({
            fileName: `docx-image-${Date.now()}.${extensionFromMime(image.contentType)}`,
            data: Buffer.from(base64, 'base64'),
            contentType: image.contentType || 'application/octet-stream',
            type: 'image',
            alt: image.altText || 'document image',
          });
          assets.push(asset);
          return { src: asset.url, alt: asset.alt };
        }),
      },
    );

    const turndown = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
    });
    turndown.addRule('tables', {
      filter: 'table',
      replacement: (_content, node) => {
        const table = node as unknown as {
          rows: ArrayLike<{ cells: ArrayLike<{ textContent: string | null }> }>;
        };
        const rows = Array.from(table.rows, (row) =>
          Array.from(row.cells, (cell) => cell.textContent?.trim() ?? ''),
        );
        return `\n\n${tableToMarkdown(rows)}\n\n`;
      },
    });
    const markdown = turndown.turndown(result.value).trim();
    return {
      markdown: `# ${titleFromFileName(fileName)}\n\n${markdown}\n`,
      assets,
      ready: true,
      parser: 'mammoth+turndown',
      warnings: result.messages.map((message) => message.message),
    };
  }
}
