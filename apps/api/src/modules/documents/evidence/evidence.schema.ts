import { Schema } from 'mongoose';
import { EvidenceUnit } from './evidence.types';

export interface EvidenceRecord extends EvidenceUnit {
  documentId: string;
  contentId: string;
  ordinal: number;
  digest: string;
}
export const EVIDENCE_MODEL = 'DocumentEvidence';
export const EvidenceSchema = new Schema<EvidenceRecord>(
  {
    documentId: { type: String, required: true, index: true },
    contentId: { type: String, required: true, index: true },
    ordinal: { type: Number, required: true },
    digest: { type: String, required: true },
    schema: { type: String, required: true },
    id: { type: String, required: true },
    kind: { type: String, required: true },
    source: { type: Object, required: true },
    objectKeys: { type: [String], required: true },
    text: { type: String, default: '' },
    producer: { type: String, required: true },
    data: { type: Object, required: true },
  },
  { collection: 'document_evidence', versionKey: false, minimize: false },
);
EvidenceSchema.index({ contentId: 1, id: 1 }, { unique: true });
EvidenceSchema.index(
  { documentId: 1, contentId: 1, ordinal: 1 },
  { unique: true },
);
