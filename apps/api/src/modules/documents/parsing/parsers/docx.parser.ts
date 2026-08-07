import { Injectable } from '@nestjs/common';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { extensionFromMime, titleFromFileName } from '../parser.utils';
import { FileParserContext, FormatParser, ParsedDocument } from '../file-parser.types';

@Injectable()
export class DocxParser implements FormatParser {
  async parse(buffer: Buffer, fileName: string, context: FileParserContext): Promise<ParsedDocument> {
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
          return { src: asset.url, alt: asset.alt };
        }),
      },
    );

    const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
    const markdown = turndown.turndown(result.value).trim();
    return {
      markdown: `# ${titleFromFileName(fileName)}\n\n${markdown}\n`,
      assets: [],
      ready: true,
      parser: 'mammoth+turndown',
      warnings: result.messages.map((message) => message.message),
    };
  }
}
