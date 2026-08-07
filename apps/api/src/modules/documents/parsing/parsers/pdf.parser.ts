import { Injectable, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import { PNG } from 'pngjs';
import { tableToMarkdown } from '../markdown-table.util';
import { AssetUploadInput, FileParserContext, FormatParser, ParsedAsset, ParsedDocument } from '../file-parser.types';
import { errorMessage, titleFromFileName } from '../parser.utils';

@Injectable()
export class PdfParser implements FormatParser {
  private readonly logger = new Logger(PdfParser.name);

  async parse(buffer: Buffer, fileName: string, context: FileParserContext): Promise<ParsedDocument> {
    const pages: Array<{ text: string; images: ParsedAsset[] }> = [];
    const parsed = await pdfParse(buffer, {
      pagerender: async (pageData: any) => {
        const content = await pageData.getTextContent();
        const text = this.renderText(content.items);
        const images = await this.extractImages(pageData, pages.length + 1, context);
        pages.push({ text, images });
        return text;
      },
    });

    const pageContents = pages.length
      ? pages
      : parsed.text.split('\f').map((text) => ({ text, images: [] as ParsedAsset[] }));
    const markdownPages = pageContents.map((page, index) => {
      const body = this.pageToMarkdown(page.text);
      const imageLinks = page.images.map(
        (asset) => `![${asset.alt ?? `page ${index + 1} image`}](${asset.url})`,
      );
      return `## Page ${index + 1}\n\n${[body || '_No text extracted from this page._', ...imageLinks].join('\n\n')}`;
    });

    return {
      markdown: `# ${titleFromFileName(fileName)}\n\n${markdownPages.join('\n\n')}\n`,
      assets: pages.flatMap((page) => page.images),
      ready: true,
      parser: 'pdf-parse',
      warnings: [],
    };
  }

  private renderText(items: Array<{ str?: string; transform?: number[] }>): string {
    let output = '';
    let previousY: number | undefined;
    let previousX: number | undefined;

    for (const item of items) {
      const value = item.str?.trim();
      if (!value) {
        continue;
      }
      const x = item.transform?.[4] ?? 0;
      const y = item.transform?.[5] ?? previousY ?? 0;
      if (previousY !== undefined) {
        if (Math.abs(y - previousY) > 2) {
          output += '\n';
        } else if (previousX !== undefined && x - previousX > 36) {
          output += '\t';
        } else {
          output += ' ';
        }
      }
      output += value;
      previousX = x + value.length * 5;
      previousY = y;
    }
    return output.trim();
  }

  private pageToMarkdown(text: string): string {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const tabularLines = lines.filter((line) => line.includes('\t'));
    const normalLines = lines.filter((line) => !line.includes('\t'));
    const table = tabularLines.length >= 2
      ? tableToMarkdown(tabularLines.map((line) => line.split('\t').map((cell) => cell.trim())))
      : '';
    const bodyLines = normalLines.length
      ? [this.looksLikeHeading(normalLines[0]) ? `### ${normalLines[0]}` : normalLines[0], ...normalLines.slice(1)]
      : [];
    return [bodyLines.join('\n\n'), table].filter(Boolean).join('\n\n');
  }

  private looksLikeHeading(value: string): boolean {
    return value.length <= 100 && !/[.!?。！？；;：:]$/.test(value) && value.split(/\s+/).length <= 12;
  }

  private async extractImages(
    pageData: any,
    pageNumber: number,
    context: FileParserContext,
  ): Promise<ParsedAsset[]> {
    const images: ParsedAsset[] = [];
    try {
      const operatorList = await pageData.getOperatorList();
      const imageOperations = new Set([82, 85, 86, 87, 88]);
      for (let index = 0; index < operatorList.fnArray.length; index += 1) {
        if (!imageOperations.has(operatorList.fnArray[index])) {
          continue;
        }
        const imageName = operatorList.argsArray[index]?.[0];
        if (typeof imageName !== 'string' || !pageData.objs?.isResolved?.(imageName)) {
          continue;
        }
        const imageData = pageData.objs.get(imageName);
        const png = this.imageToPng(imageData);
        if (!png) {
          continue;
        }
        images.push(await context.uploadAsset({
          fileName: `page-${pageNumber}-image-${images.length + 1}.png`,
          data: png,
          contentType: 'image/png',
          type: 'image',
          alt: `page ${pageNumber} image`,
        }));
      }
    } catch (error) {
      this.logger.warn(`PDF image extraction skipped on page ${pageNumber}: ${errorMessage(error)}`);
    }
    return images;
  }

  private imageToPng(imageData: any): Buffer | undefined {
    const width = Number(imageData?.width);
    const height = Number(imageData?.height);
    const source = imageData?.data;
    if (!width || !height || !source) {
      return undefined;
    }

    const kind = Number(imageData.kind ?? 3);
    const rgba = Buffer.alloc(width * height * 4);
    if (kind === 1) {
      const bytes = Buffer.from(source);
      const rowBytes = Math.ceil(width / 8);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const bit = (bytes[y * rowBytes + Math.floor(x / 8)] >> (7 - (x % 8))) & 1;
          const value = bit ? 0 : 255;
          const offset = (y * width + x) * 4;
          rgba[offset] = value;
          rgba[offset + 1] = value;
          rgba[offset + 2] = value;
          rgba[offset + 3] = 255;
        }
      }
    } else if (kind === 2) {
      const bytes = Buffer.from(source);
      for (let index = 0; index < width * height; index += 1) {
        const sourceOffset = index * 3;
        const targetOffset = index * 4;
        rgba[targetOffset] = bytes[sourceOffset] ?? 0;
        rgba[targetOffset + 1] = bytes[sourceOffset + 1] ?? 0;
        rgba[targetOffset + 2] = bytes[sourceOffset + 2] ?? 0;
        rgba[targetOffset + 3] = 255;
      }
    } else if (kind === 3) {
      Buffer.from(source).copy(rgba, 0, 0, Math.min(rgba.length, source.length));
    } else {
      return undefined;
    }

    return PNG.sync.write({ width, height, data: rgba } as any);
  }
}
