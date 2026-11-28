import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EVIDENCE_MODEL, EvidenceRecord } from './evidence.schema';
import { EvidenceManifest, EvidenceUnit } from './evidence.types';
import { evidenceDigest } from './evidence-manifest';

@Injectable()
export class DocumentEvidenceStore {
  constructor(
    @InjectModel(EVIDENCE_MODEL) private readonly model: Model<EvidenceRecord>,
  ) {}

  async save(
    documentId: string,
    contentId: string,
    units: EvidenceUnit[],
  ): Promise<void> {
    for (let offset = 0; offset < units.length; offset += 100) {
      await this.model.bulkWrite(
        units.slice(offset, offset + 100).map((unit, index) => ({
          updateOne: {
            filter: { documentId, contentId, id: unit.id },
            update: {
              $setOnInsert: {
                ...unit,
                documentId,
                contentId,
                ordinal: offset + index,
                digest: evidenceDigest(unit),
              },
            },
            upsert: true,
          },
        })),
      );
    }
  }

  async verify(
    documentId: string,
    contentId: string,
    manifest: EvidenceManifest,
  ): Promise<void> {
    const rows = await this.model
      .find({ documentId, contentId })
      .sort({ ordinal: 1 })
      .lean()
      .exec();
    const digests = rows.map(
      ({
        documentId: _doc,
        contentId: _content,
        ordinal: _ordinal,
        digest,
        _id: _id,
        ...unit
      }) => {
        if (evidenceDigest(unit) !== digest)
          throw new Error('Evidence record integrity check failed');
        return digest;
      },
    );
    if (
      rows.length !== manifest.count ||
      evidenceDigest(digests) !== manifest.digest
    )
      throw new Error('Evidence manifest is incomplete or mismatched');
  }

  async page(
    documentId: string,
    contentId: string,
    offset: number,
    limit: number,
  ) {
    return this.model
      .find({ documentId, contentId })
      .sort({ ordinal: 1 })
      .skip(offset)
      .limit(limit)
      .select('-_id -digest')
      .lean()
      .exec();
  }
  async deleteContent(contentId: string) {
    await this.model.deleteMany({ contentId });
  }
  async deleteDocument(documentId: string) {
    await this.model.deleteMany({ documentId });
  }
}
