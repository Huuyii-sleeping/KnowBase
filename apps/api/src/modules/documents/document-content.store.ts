import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ParsedAsset } from './parsing/file-parser.types';
import { DocumentContent, DocumentContentDocument } from './schemas/document-content.schema';

export interface DocumentContentInput {
  contentId: string;
  documentId: string;
  markdown: string;
  parser: string;
  warnings: string[];
  version: number;
  assets: ParsedAsset[];
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
}
