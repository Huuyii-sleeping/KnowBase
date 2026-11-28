import { DocumentArtifactVerifier } from './evidence/document-artifact-verifier';
import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';
import { ParsedAsset, ParseQuality } from './parsing/file-parser.types';
import { DocumentEvidenceStore } from './evidence/document-evidence.store';
import { EvidenceUnit } from './evidence/evidence.types';
import { evidenceManifest } from './evidence/evidence-manifest';
import { tableEvidence } from './evidence/table-evidence';
import { markdownBlocks } from '../ingestion/markdown-blocks';
import { PARSE_STRATEGY, SourceSection } from '../ingestion/document-structure';
import {
  DocumentContent,
  DocumentContentDocument,
} from './schemas/document-content.schema';

export interface DocumentContentInput {
  evidence?: EvidenceUnit[];
  ready?: boolean;
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
    @Optional() private readonly evidence?: DocumentEvidenceStore,
    @Optional() private readonly artifacts?: DocumentArtifactVerifier,
  ) {}

  async create(input: DocumentContentInput): Promise<void> {
    const blocks = markdownBlocks(input.markdown, input.sections);
    const { evidence: extracted = [], ...body } = input;
    const units: EvidenceUnit[] = [
      ...extracted,
      ...blocks.flatMap((block) => tableEvidence(block, input.parser)),
    ];
    const manifest = evidenceManifest(
      units,
      input.assets.map((asset) => asset.objectKey),
    );
    if (units.length && !this.evidence)
      throw new Error('Evidence persistence is not configured');
    const record = {
      ...body,
      ...(this.evidence ? { evidenceManifest: manifest } : {}),
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
    await this.artifacts?.verify(input.assets);
    if (this.evidence) {
      await this.evidence.save(input.documentId, input.contentId, units);
      await this.evidence.verify(input.documentId, input.contentId, manifest);
    }
    await new this.contentModel(record).save();
  }

  async findByContentId(contentId: string) {
    return this.contentModel.findOne({ contentId }).lean().exec();
  }

  async verifyEvidence(contentId: string): Promise<void> {
    const body = await this.findByContentId(contentId);
    if (!body) throw new Error('Document content is missing');
    await this.artifacts?.verify(body.assets);
    if (body.evidenceManifest) {
      if (!this.evidence)
        throw new Error('Evidence persistence is not configured');
      await this.evidence.verify(
        body.documentId,
        contentId,
        body.evidenceManifest,
      );
    }
  }

  async deleteByContentId(contentId: string): Promise<void> {
    await this.evidence?.deleteContent(contentId);
    await this.contentModel.deleteOne({ contentId });
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    await this.evidence?.deleteDocument(documentId);
    await this.contentModel.deleteMany({ documentId });
  }

  async assetKeys(documentId: string): Promise<string[]> {
    return this.contentModel
      .distinct('assets.objectKey', { documentId })
      .exec();
  }

  async referencesAsset(objectKey: string): Promise<boolean> {
    return Boolean(
      await this.contentModel.exists({ 'assets.objectKey': objectKey }),
    );
  }
}
