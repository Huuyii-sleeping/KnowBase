import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

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
}

export const DocumentContentSchema = SchemaFactory.createForClass(DocumentContent);
