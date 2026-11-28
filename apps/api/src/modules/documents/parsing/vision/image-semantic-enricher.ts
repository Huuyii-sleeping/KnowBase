import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ParsedDocument } from '../file-parser.types';
import {
  VisionDescriptionAdapter,
  VisualDescription,
} from './vision-description.adapter';
@Injectable()
export class ImageSemanticEnricher {
  constructor(private readonly vision: VisionDescriptionAdapter) {}
  async enrich(
    result: ParsedDocument,
    inputs: Map<string, { bytes: Buffer; mime: string }>,
    signal?: AbortSignal,
  ) {
    if (!this.vision.requested) return;
    const images = (result.evidence ?? []).filter(
      (unit) =>
        unit.kind === 'image' &&
        unit.data.representation !== 'visual_description',
    );
    if (!images.length) return;
    let attempted = 0;
    // Only reuse within this document attempt; each source keeps its own evidence and permissions.
    const descriptions = new Map<string, Promise<VisualDescription>>();
    const issues = [...(result.quality?.issues ?? [])];
    for (const image of images) {
      signal?.throwIfAborted();
      const id = `description-${image.id}`;
      const input = inputs.get(image.objectKeys[0]);
      if (!input) {
        issues.push({
          code: 'IMAGE_DESCRIPTION_MISSING',
          evidenceId: image.id,
          message:
            'Visual description requires review: image missing or image count budget exceeded.',
        });
        continue;
      }
      const inputSha256 = createHash('sha256')
        .update(input.bytes)
        .digest('hex');
      const key = `${input.mime}:${inputSha256}`;
      if (!descriptions.has(key) && attempted >= 12) {
        issues.push({
          code: 'IMAGE_DESCRIPTION_MISSING',
          evidenceId: image.id,
          message:
            'Visual description unique-image budget exceeded; original image remains available.',
        });
        continue;
      }
      try {
        if (!descriptions.has(key)) {
          attempted++;
          descriptions.set(
            key,
            this.vision.describe(input.bytes, input.mime, signal),
          );
        }
        const description = await descriptions.get(key)!;
        const text = [
          description.description,
          ...description.facts,
          ...description.relations.map(
            (edge) => `${edge.from} → ${edge.to}: ${edge.relation}`,
          ),
          ...description.uncertain.map((item) => `待核对: ${item}`),
        ].join('\n');
        const start = result.markdown.length;
        result.markdown += `\n\n### 图像机器描述（需核对）\n\n${text}\n\n`;
        (result.sections ??= []).push({
          start,
          end: result.markdown.length,
          source: image.source,
        });
        (result.evidence ??= []).push({
          schema: 'evidence-v1',
          id,
          kind: 'image',
          source: image.source,
          objectKeys: image.objectKeys,
          text,
          producer: `vision:${this.vision.revision}`,
          data: {
            representation: 'visual_description',
            inputEvidenceId: image.id,
            review: 'needs_review',
            modelRevision: this.vision.revision,
            inputSha256,
            ...description,
          },
        });
        issues.push({
          code: 'IMAGE_DESCRIPTION_REVIEW',
          evidenceId: id,
          message:
            'Generated image description must be checked against the image before adoption.',
        });
      } catch (error) {
        signal?.throwIfAborted();
        issues.push({
          code: 'IMAGE_DESCRIPTION_FAILED',
          evidenceId: image.id,
          message:
            'Visual description unavailable; OCR and original image remain available for review.',
        });
      }
    }
    result.ready = false;
    result.quality = { status: 'needs_review', issues };
    result.warnings = [
      ...new Set([...result.warnings, ...issues.map((issue) => issue.message)]),
    ];
  }
}
