import { createHash } from 'node:crypto';
import { EvidenceUnit } from './evidence.types';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, canonical(value)]),
    );
  return value;
}
export const evidenceDigest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

export function evidenceManifest(units: EvidenceUnit[], assetKeys: string[]) {
  if (units.length > 100000) throw new Error('Evidence count exceeds budget');
  const ids = new Set<string>();
  const assets = new Set(assetKeys);
  let bytes = 0;
  for (const unit of units) {
    if (
      !unit ||
      ![
        'image',
        'table',
        'worksheet_row',
        'audio_segment',
        'video_scene',
        'web_snapshot',
      ].includes(unit.kind) ||
      typeof unit.text !== 'string' ||
      typeof unit.producer !== 'string' ||
      !unit.producer ||
      !unit.source ||
      Array.isArray(unit.source) ||
      typeof unit.source !== 'object' ||
      !unit.data ||
      Array.isArray(unit.data) ||
      typeof unit.data !== 'object' ||
      !Array.isArray(unit.objectKeys) ||
      unit.objectKeys.some((key) => typeof key !== 'string')
    )
      throw new Error('Invalid evidence shape');
    if (
      unit.schema !== 'evidence-v1' ||
      !/^[\w-]{1,100}$/.test(unit.id) ||
      ids.has(unit.id)
    )
      throw new Error('Invalid or duplicate evidence identity');
    ids.add(unit.id);
    const size = Buffer.byteLength(JSON.stringify(unit));
    bytes += size;
    if (size > 1024 * 1024 || bytes > 64 * 1024 * 1024)
      throw new Error('Evidence record exceeds byte budget');
    if (unit.objectKeys.some((key) => !assets.has(key)))
      throw new Error('Evidence references an unregistered asset');
    const { startMs, endMs, bbox } = unit.source;
    if (
      (startMs !== undefined || endMs !== undefined) &&
      (!Number.isSafeInteger(startMs) ||
        !Number.isSafeInteger(endMs) ||
        startMs! < 0 ||
        endMs! <= startMs!)
    )
      throw new Error('Invalid evidence time range');
    if (
      bbox &&
      (!Array.isArray(bbox) ||
        bbox.length !== 4 ||
        !bbox.every(Number.isFinite))
    )
      throw new Error('Invalid evidence bounding box');
    assertJson(unit);
  }
  return {
    count: units.length,
    digest: evidenceDigest(units.map(evidenceDigest)),
  };
}

function assertJson(value: unknown): void {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  )
    return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach(assertJson);
    return;
  }
  if (
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    Object.values(value).forEach(assertJson);
    return;
  }
  throw new Error('Evidence must contain finite JSON values');
}
