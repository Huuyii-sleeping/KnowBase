import { Schema } from 'mongoose';

export const ASSET_REGISTRY_MODEL = 'StoredDocumentAsset';
export interface StoredDocumentAsset {
  objectKey: string;
  documentId: string;
  contentType: string;
  bytes: number;
  sha256: string;
  createdAt: Date;
}
export const AssetRegistrySchema = new Schema<StoredDocumentAsset>(
  {
    objectKey: { type: String, required: true, unique: true },
    documentId: { type: String, required: true, index: true },
    contentType: { type: String, required: true },
    bytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'document_assets', versionKey: false },
);
AssetRegistrySchema.index({ createdAt: 1 });
