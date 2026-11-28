import { describe, expect, it } from 'vitest';
import { evidenceDigest, evidenceManifest } from './evidence-manifest';
import { EvidenceUnit } from './evidence.types';

const unit: EvidenceUnit = {
  schema: 'evidence-v1',
  id: 'image-1',
  kind: 'image',
  source: { page: 2 },
  objectKeys: ['assets/doc/img'],
  text: 'zero 0',
  producer: 'test-v1',
  data: { number: 0, empty: null },
};
describe('evidence manifest', () => {
  it('is stable across persistence property ordering and binds original values', () => {
    expect(evidenceDigest({ z: null, a: { b: 0, a: false } })).toBe(
      evidenceDigest({ a: { a: false, b: 0 }, z: null }),
    );
    expect(evidenceManifest([unit], unit.objectKeys)).toEqual({
      count: 1,
      digest: evidenceDigest([evidenceDigest(unit)]),
    });
    expect(
      evidenceManifest([{ ...unit, text: 'changed' }], unit.objectKeys).digest,
    ).not.toBe(evidenceManifest([unit], unit.objectKeys).digest);
  });
  it('rejects duplicate identities, unregistered assets and invalid locations', () => {
    expect(() => evidenceManifest([unit, unit], unit.objectKeys)).toThrow(
      'identity',
    );
    expect(() => evidenceManifest([unit], [])).toThrow('unregistered');
    expect(() =>
      evidenceManifest(
        [{ ...unit, source: { startMs: 10, endMs: 9 } }],
        unit.objectKeys,
      ),
    ).toThrow('time');
    expect(() =>
      evidenceManifest(
        [{ ...unit, source: { bbox: [0, NaN, 1, 1] } }],
        unit.objectKeys,
      ),
    ).toThrow('bounding');
    expect(() =>
      evidenceManifest(
        [{ ...unit, text: 'x'.repeat(1024 * 1024) }],
        unit.objectKeys,
      ),
    ).toThrow('budget');
  });
});
