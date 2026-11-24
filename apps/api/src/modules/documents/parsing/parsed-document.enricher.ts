import { Injectable } from '@nestjs/common';
import { FileParserContext, ParsedDocument } from './file-parser.types';
import { XlsxEvidenceExtractor } from './xlsx/xlsx-evidence.extractor';
import { XlsEvidenceExtractor } from './xlsx/xls-evidence.extractor';
import { ImageSemanticEnricher } from './vision/image-semantic-enricher';
/** Coordinates supplemental evidence; format readers and model adapters own extraction. */
@Injectable()
export class ParsedDocumentEnricher {
  constructor(
    private readonly xlsx: XlsxEvidenceExtractor,
    private readonly xls: XlsEvidenceExtractor,
    private readonly semantics: ImageSemanticEnricher,
  ) {}
  async enrich(
    result: ParsedDocument,
    bytes: Buffer,
    extension: string,
    context: FileParserContext,
    imageInputs: Map<string, { bytes: Buffer; mime: string }>,
  ) {
    if (extension === '.xlsx' || extension === '.xls') {
      const native =
        extension === '.xlsx'
          ? await this.xlsx.extract(bytes)
          : await this.xls.extract(bytes, context.execution?.signal);
      result.evidence = [...(result.evidence ?? []), ...native.evidence];
      if (native.issues.length) {
        result.ready = false;
        result.error = 'Workbook cell evidence requires manual review.';
        result.warnings.push(...native.issues.map((issue) => issue.message));
        result.quality = {
          status: 'needs_review',
          issues: [...(result.quality?.issues ?? []), ...native.issues],
        };
      }
    }
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
      const asset = await context.uploadAsset({
        fileName: `source-image${extension}`,
        data: bytes,
        contentType:
          extension === '.jpg' || extension === '.jpeg'
            ? 'image/jpeg'
            : `image/${extension.slice(1)}`,
        type: 'image',
      });
      (result.evidence ??= []).push({
        schema: 'evidence-v1',
        id: 'original-image',
        kind: 'image',
        source: { page: 1 },
        objectKeys: [asset.objectKey],
        text: result.markdown.slice(0, 10000),
        producer: 'input-image-v1',
        data: {
          representation: 'original_image',
          semanticAnalysis: 'not_requested',
        },
      });
    }
    await this.semantics.enrich(result, imageInputs, context.execution?.signal);
  }
}
