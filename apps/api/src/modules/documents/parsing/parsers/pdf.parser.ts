import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { integerOption } from '../../../ingestion/numeric-option';
import pdfParse from 'pdf-parse';
import {
  FileParserContext,
  FormatParser,
  ParsedAsset,
  ParsedDocument,
} from '../file-parser.types';
import { titleFromFileName } from '../parser.utils';

import { PdfImages } from './pdf-images';
import { renderPdfText, pdfPageMarkdown } from './pdf-text';
import { SourceSection } from '../../../ingestion/document-structure';

@Injectable()
export class PdfParser implements FormatParser {
  private readonly images = new PdfImages();
  constructor(private readonly config: ConfigService = new ConfigService()) {}

  async parse(
    buffer: Buffer,
    fileName: string,
    context: FileParserContext,
  ): Promise<ParsedDocument> {
    const pages: Array<{ text: string; images: ParsedAsset[] }> = [];
    const canExtractImages =
      typeof (globalThis as { document?: unknown }).document !== 'undefined';
    // The bundled PDF.js treats Buffer.slice() as TypedArray.slice(), corrupting
    // small pooled inputs. A real Uint8Array also isolates the parser's mutations.
    const maxPages = integerOption(this.config, 'INGESTION_MAX_PAGES', 1000);
    const parsed = await pdfParse(new Uint8Array(buffer) as Buffer, {
      max: maxPages + 1,
      pagerender: async (pageData: any) => {
        const index = Number(pageData.pageNumber ?? pages.length + 1) - 1;
        pages[index] = { text: '', images: [] };
        const content = await pageData.getTextContent();
        const text = renderPdfText(content.items);
        // pdf-parse bundles a browser-oriented PDF.js image pipeline. Calling
        // getOperatorList in Node can crash the process through document APIs.
        const images = canExtractImages
          ? await this.images.extract(pageData, index + 1, context)
          : [];
        pages[index] = { text, images };
        return text;
      },
    });
    if (parsed.numpages > maxPages)
      throw new Error('PDF exceeds INGESTION_MAX_PAGES');

    // pdf-parse swallows individual getPage/pagerender failures. Missing pages
    // must still be counted as incomplete rather than silently becoming READY.
    const pageContents = Array.from(
      { length: parsed.numpages || pages.length || 1 },
      (_, index) => pages[index] ?? { text: '', images: [] as ParsedAsset[] },
    );
    const markdownPages = pageContents.map((page, index) => {
      const body = pdfPageMarkdown(page.text);
      const imageLinks = page.images.map(
        (asset) => `![${asset.alt ?? `page ${index + 1} image`}](${asset.url})`,
      );
      return `## Page ${index + 1}\n\n${[body || '_No text extracted from this page._', ...imageLinks].join('\n\n')}`;
    });

    const sections: SourceSection[] = [];
    let markdown = `# ${titleFromFileName(fileName)}\n\n`;
    markdownPages.forEach((page, index) => {
      const start = markdown.length;
      markdown += page + '\n\n';
      sections.push({
        start,
        end: markdown.length,
        source: { page: index + 1 },
      });
    });
    const emptyPages = pageContents.flatMap((page, index) =>
      page.text.trim() ? [] : [index + 1],
    );
    const qualityError = emptyPages.length
      ? `No extractable text on PDF pages ${emptyPages.join(', ')}; OCR or manual review required.`
      : undefined;
    return {
      sections,
      markdown: markdown,
      assets: pages.flatMap((page) => page.images),
      ready: !qualityError,
      error: qualityError,
      parser: 'pdf-parse',
      warnings: [
        ...(canExtractImages
          ? []
          : [
              'Embedded PDF image extraction is skipped in the Node.js parser runtime.',
            ]),
        ...(qualityError ? [qualityError] : []),
      ],
    };
  }
}
