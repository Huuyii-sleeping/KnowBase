import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ParseQuality } from '../parsing/file-parser.types';
import { EvidenceManifest } from '../evidence/evidence.types';
import { TableEvidence } from '../../ingestion/tables/table.types';
import {
  DocumentBlock,
  SourceSection,
} from '../../ingestion/document-structure';

export type DocumentContentDocument = HydratedDocument<DocumentContent>;

@Schema({ _id: false })
export class DocumentAsset {
  @Prop({ required: true })
  type!: string;

  @Prop({ required: true })
  objectKey!: string;

  @Prop()
  url?: string;

  @Prop()
  alt?: string;

  @Prop()
  contentType?: string;

  @Prop()
  sha256?: string;

  @Prop()
  bytes?: number;
}

export const DocumentAssetSchema = SchemaFactory.createForClass(DocumentAsset);

@Schema({ collection: 'document_content', timestamps: true })
export class DocumentContent {
  @Prop({ name: 'content_id', required: true, unique: true, index: true })
  contentId!: string;

  @Prop({ name: 'document_id', required: true, index: true })
  documentId!: string;

  @Prop({ required: true })
  markdown!: string;

  @Prop({ required: true })
  parser!: string;

  @Prop({ type: [String], default: [] })
  warnings!: string[];

  @Prop({ required: true, default: 1 })
  version!: number;

  @Prop({ type: [DocumentAssetSchema], default: [] })
  assets!: DocumentAsset[];

  @Prop({ required: true, default: 0 })
  characterCount!: number;

  @Prop({ type: [Object], default: undefined })
  blocks?: DocumentBlock[];

  @Prop({ type: [Object], default: undefined })
  sections?: SourceSection[];

  @Prop({ type: [Object], default: undefined })
  tables?: TableEvidence[];

  @Prop({ type: Object })
  evidenceManifest?: EvidenceManifest;

  @Prop()
  ready?: boolean;

  @Prop()
  parseStrategy?: string;

  @Prop({ type: Object })
  quality?: ParseQuality;

  @Prop({ type: Object })
  provenance?: Record<string, string>;
}

export const DocumentContentSchema =
  SchemaFactory.createForClass(DocumentContent);
