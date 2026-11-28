import { SupplementaryParsers } from './supplementary-parsers';
import { ParsedDocumentEnricher } from './parsed-document.enricher';
import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'node:path';
import { AssetUploaderService } from './asset-uploader.service';
import {
  FileParserContext,
  FormatParser,
  ParsedDocument,
  ParsedAsset,
  ParseExecution,
} from './file-parser.types';
import { errorMessage } from './parser.utils';
import { OfficeParserFallback } from './parsers/office-parser.fallback';
import { DocxParser } from './parsers/docx.parser';
import { MarkdownParser } from './parsers/markdown.parser';
import { PdfParser } from './parsers/pdf.parser';
import { PptxParser } from './parsers/pptx.parser';
import { TextParser } from './parsers/text.parser';
import { XlsxParser } from './parsers/xlsx.parser';
import { completeParsedDocument } from './parsed-document.util';
import { ingestionStage } from '../../ingestion/ingestion-stage';
import { MineruParser } from './mineru/mineru.parser';
import { mineruSupports } from './mineru/mineru-formats';
import { integerOption } from '../../ingestion/numeric-option';
import { DEFAULT_DOCUMENT_PARSER } from './parser-defaults';
import { ParseCapacity } from '../ingestion/parse-capacity';

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.xlsx',
  '.docx',
  '.pptx',
  '.txt',
  '.md',
]);

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);
  private readonly parsers = new Map<string, FormatParser>();
  private readonly capacity: ParseCapacity;

  constructor(
    textParser: TextParser,
    markdownParser: MarkdownParser,
    pdfParser: PdfParser,
    xlsxParser: XlsxParser,
    docxParser: DocxParser,
    pptxParser: PptxParser,
    private readonly fallback: OfficeParserFallback,
    private readonly assetUploader: AssetUploaderService,
    @Optional() private readonly mineru?: MineruParser,
    @Optional() private readonly config: ConfigService = new ConfigService(),
    @Optional() private readonly additional?: SupplementaryParsers,
    @Optional() private readonly enricher?: ParsedDocumentEnricher,
  ) {
    const provider = config.get<string>(
      'DOCUMENT_PARSER',
      DEFAULT_DOCUMENT_PARSER,
    );
    if (!['native', 'mineru'].includes(provider))
      throw new Error('Invalid DOCUMENT_PARSER');
    this.capacity = new ParseCapacity(
      integerOption(config, 'INGESTION_PARSE_CONCURRENCY', 1),
    );
    this.parsers.set('.txt', textParser);
    this.parsers.set('.md', markdownParser);
    this.parsers.set('.pdf', pdfParser);
    this.parsers.set('.xlsx', xlsxParser);
    this.parsers.set('.docx', docxParser);
    this.parsers.set('.pptx', pptxParser);
  }

  supports(fileName: string): boolean {
    const ext = extname(fileName).toLowerCase();
    return (
      Boolean(this.additional?.get(ext)) ||
      SUPPORTED_EXTENSIONS.has(ext) ||
      (this.useMineru(ext) && mineruSupports(ext))
    );
  }

  assertFileBudget(buffer: Buffer): void {
    if (
      buffer.length >
      integerOption(this.config, 'INGESTION_MAX_FILE_BYTES', 104857600)
    )
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'File exceeds ingestion byte budget',
      });
  }

  private useMineru(extension: string): boolean {
    return (
      this.config.get<string>('DOCUMENT_PARSER', DEFAULT_DOCUMENT_PARSER) ===
        'mineru' && !['.md', '.txt'].includes(extension)
    );
  }

  async parse(
    buffer: Buffer,
    fileName: string,
    documentId: string,
    execution?: ParseExecution,
  ): Promise<ParsedDocument> {
    return this.capacity.run(execution?.signal, () =>
      this.parseFile(buffer, fileName, documentId, execution),
    );
  }

  private async parseFile(
    buffer: Buffer,
    fileName: string,
    documentId: string,
    execution?: ParseExecution,
  ): Promise<ParsedDocument> {
    if (!this.supports(fileName))
      throw new BadRequestException('Unsupported file type');
    const extension = extname(fileName).toLowerCase();
    const additionalParser = this.additional?.get(extension);
    const remote = Boolean(additionalParser) || this.useMineru(extension);
    const parser =
      additionalParser ?? (remote ? this.mineru : this.parsers.get(extension));
    this.assertFileBudget(buffer);
    if (!parser) {
      throw new BadRequestException(
        'No parser is configured for this file format',
      );
    }

    let uploaded: ParsedAsset[] = [];
    let assetBytes = 0;
    const imageInputs = new Map<string, { bytes: Buffer; mime: string }>();
    const context: FileParserContext = {
      documentId,
      execution,
      uploadAsset: async (input) => {
        execution?.signal?.throwIfAborted();
        assetBytes += input.data.length;
        if (
          assetBytes >
          integerOption(this.config, 'MINERU_RESULT_MAX_BYTES', 67108864)
        )
          throw new Error('Extracted assets exceed byte budget');
        const asset = await this.assetUploader.upload(documentId, input);
        uploaded.push(asset);
        if (input.contentType.startsWith('image/'))
          imageInputs.set(asset.objectKey, {
            bytes: input.data,
            mime: input.contentType,
          });
        await execution?.onAsset?.(asset);
        return asset;
      },
    };

    try {
      const result = await ingestionStage(
        'parse',
        { documentId, bytes: buffer.length, format: extension },
        () => parser.parse(buffer, fileName, context),
      );
      await this.enricher?.enrich(
        result,
        buffer,
        extension,
        context,
        imageInputs,
      );
      return this.complete({
        ...result,
        assets: this.mergeAssets(result.assets, uploaded),
      });
    } catch (error) {
      this.logger.warn(
        `Primary parser failed for ${fileName}: ${errorMessage(error)}`,
      );
      await this.assetUploader.discard(documentId, uploaded);
      uploaded = [];
      if (remote && execution) throw error;
      try {
        if (
          remote ||
          execution?.signal?.aborted ||
          /exceeds.*budget|INGESTION_MAX_PAGES/.test(errorMessage(error))
        )
          throw new Error(
            'Document parsing failed; retry or inspect parser service.',
          );
        // Office fallback cannot repair invalid text encoding or binary text uploads.
        if (extension === '.txt' || extension === '.md') throw error;
        const result = await this.fallback.parse(
          buffer,
          fileName,
          context,
          error,
        );
        return this.complete({
          ...result,
          assets: this.mergeAssets(result.assets, uploaded),
        });
      } catch (fallbackError) {
        await this.assetUploader.discard(documentId, uploaded);
        const message = errorMessage(fallbackError);
        this.logger.error(`Fallback parser failed for ${fileName}: ${message}`);
        return {
          markdown: `# ${fileName}\n\n> Parsing failed: ${message}`,
          assets: [],
          ready: false,
          parser: 'failed',
          warnings: [errorMessage(error)],
          error: message,
          quality: {
            status: 'failed',
            issues: [
              { code: 'PARSER_FAILED', message: 'Document parsing failed.' },
            ],
          },
        };
      }
    }
  }

  discardAssets(documentId: string, assets: ParsedAsset[]): Promise<void> {
    return this.assetUploader.discard(documentId, assets);
  }

  private complete(result: ParsedDocument): ParsedDocument {
    if (
      Buffer.byteLength(result.markdown) >
      integerOption(this.config, 'INGESTION_MAX_CONTENT_BYTES', 4194304)
    )
      throw new Error('Parsed content exceeds byte budget');
    return completeParsedDocument(result);
  }

  private mergeAssets(
    assets: ParsedAsset[],
    uploaded: ParsedAsset[],
  ): ParsedAsset[] {
    return [
      ...new Map(
        [...assets, ...uploaded].map((asset) => [asset.objectKey, asset]),
      ).values(),
    ];
  }
}
