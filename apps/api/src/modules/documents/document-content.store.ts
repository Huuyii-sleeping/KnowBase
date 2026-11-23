import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';
import { ParsedAsset, ParseQuality } from './parsing/file-parser.types';
import { markdownBlocks } from '../ingestion/markdown-blocks';
import { PARSE_STRATEGY, SourceSection } from '../ingestion/document-structure';
import {
  DocumentContent,
  DocumentContentDocument,
} from './schemas/document-content.schema';

export interface DocumentContentInput {
  contentId: string;
  documentId: string;
  markdown: string;
  parser: string;
  warnings: string[];
  version: number;
  assets: ParsedAsset[];
  sections?: SourceSection[];
  parseStrategy?: string;
  quality?: ParseQuality;
  provenance?: Record<string, string>;
}

// Leave headroom below MongoDB's 16 MiB limit for schema fields and timestamps.
export const MAX_CONTENT_RECORD_BYTES = 15 * 1024 * 1024;

@Injectable()
export class DocumentContentStore {
  constructor(
    @InjectModel(DocumentContent.name)
    private readonly contentModel: Model<DocumentContentDocument>,
  ) {}

  async create(input: DocumentContentInput): Promise<void> {
    const blocks = markdownBlocks(input.markdown, input.sections);
    const record = {
      ...input,
      blocks: blocks.map(({ table, ...block }) => ({
        ...block,
        ...(table ? { tableId: table.id } : {}),
      })),
      tables: blocks.flatMap((block) =>
        block.table
          ? [
              {
                ...block.table,
                start: block.start,
                end: block.end,
                source: block.source,
              },
            ]
          : [],
      ),
      parseStrategy: input.parseStrategy ?? PARSE_STRATEGY,
      characterCount: input.markdown.length,
    };
    if (mongo.BSON.calculateObjectSize(record) > MAX_CONTENT_RECORD_BYTES)
      throw new Error(
        'Structured document exceeds MongoDB content record budget',
      );
    await new this.contentModel(record).save();
  }

  async findByContentId(contentId: string) {
    return this.contentModel.findOne({ contentId }).lean().exec();
  }

  async deleteByContentId(contentId: string): Promise<void> {
    await this.contentModel.deleteOne({ contentId });
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.contentModel.deleteMany({ documentId });
  }

  async assetKeys(documentId: string): Promise<string[]> {
    return this.contentModel
      .distinct('assets.objectKey', { documentId })
      .exec();
  }
}
