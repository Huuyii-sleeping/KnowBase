import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

@Injectable()
export class DocumentContentStore {
  constructor(
    @InjectModel(DocumentContent.name)
    private readonly contentModel: Model<DocumentContentDocument>,
  ) {}

  async create(input: DocumentContentInput): Promise<void> {
    await new this.contentModel({
      ...input,
      blocks: markdownBlocks(input.markdown, input.sections),
      parseStrategy: input.parseStrategy ?? PARSE_STRATEGY,
      characterCount: input.markdown.length,
    }).save();
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
