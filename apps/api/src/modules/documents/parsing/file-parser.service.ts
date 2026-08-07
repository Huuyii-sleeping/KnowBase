import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { extname } from 'node:path';
import { AssetUploaderService } from './asset-uploader.service';
import { FileParserContext, FormatParser, ParsedDocument } from './file-parser.types';
import { errorMessage } from './parser.utils';
import { OfficeParserFallback } from './parsers/office-parser.fallback';
import { DocxParser } from './parsers/docx.parser';
import { MarkdownParser } from './parsers/markdown.parser';
import { PdfParser } from './parsers/pdf.parser';
import { PptxParser } from './parsers/pptx.parser';
import { TextParser } from './parsers/text.parser';
import { XlsxParser } from './parsers/xlsx.parser';

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.xlsx', '.docx', '.pptx', '.txt', '.md']);

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);
  private readonly parsers = new Map<string, FormatParser>();

  constructor(
    textParser: TextParser,
    markdownParser: MarkdownParser,
    pdfParser: PdfParser,
    xlsxParser: XlsxParser,
    docxParser: DocxParser,
    pptxParser: PptxParser,
    private readonly fallback: OfficeParserFallback,
    private readonly assetUploader: AssetUploaderService,
  ) {
    this.parsers.set('.txt', textParser);
    this.parsers.set('.md', markdownParser);
    this.parsers.set('.pdf', pdfParser);
    this.parsers.set('.xlsx', xlsxParser);
    this.parsers.set('.docx', docxParser);
    this.parsers.set('.pptx', pptxParser);
  }

  supports(fileName: string): boolean {
    return SUPPORTED_EXTENSIONS.has(extname(fileName).toLowerCase());
  }

  async parse(buffer: Buffer, fileName: string, documentId: string): Promise<ParsedDocument> {
    const extension = extname(fileName).toLowerCase();
    const parser = this.parsers.get(extension);
    if (!parser) {
      throw new BadRequestException('supported file types: pdf, xlsx, docx, pptx, txt, md');
    }

    const context: FileParserContext = {
      documentId,
      uploadAsset: (input) => this.assetUploader.upload(documentId, input),
    };

    try {
      return await parser.parse(buffer, fileName, context);
    } catch (error) {
      this.logger.warn(`Primary parser failed for ${fileName}: ${errorMessage(error)}`);
      try {
        return await this.fallback.parse(buffer, fileName, context, error);
      } catch (fallbackError) {
        const message = errorMessage(fallbackError);
        this.logger.error(`Fallback parser failed for ${fileName}: ${message}`);
        return {
          markdown: `# ${fileName}\n\n> Parsing failed: ${message}`,
          assets: [],
          ready: false,
          parser: 'failed',
          warnings: [errorMessage(error)],
          error: message,
        };
      }
    }
  }
}
