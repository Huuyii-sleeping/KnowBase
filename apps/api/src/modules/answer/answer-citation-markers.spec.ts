import { describe, expect, it } from 'vitest';
import { normalizeCitationMarkers } from './answer-citation-markers';

describe('citation marker formatting', () => {
  it('keeps explicitly identified grouped sources in their original order', () => {
    expect(
      normalizeCitationMarkers('事实 [S2, S1]，另一项 [S3，S2、S4]。'),
    ).toBe('事实 [S2][S1]，另一项 [S3][S2][S4]。');
    expect(normalizeCitationMarkers('事实 [S1]')).toBe('事实 [S1]');
    expect(normalizeCitationMarkers('无引用的事实')).toBe('无引用的事实');
  });

  it('does not guess ambiguous IDs or silently repair invalid markers', () => {
    for (const value of [
      '[S1, 2]',
      '[S1, S0]',
      '[S1, S01]',
      '[S1, Sx]',
      '[S1, ]',
      '[S1\nS2]',
    ]) {
      expect(normalizeCitationMarkers(value)).toBe(value);
    }
    // Validation still owns bounds; normalization must not hide an out-of-range ID.
    expect(normalizeCitationMarkers('[S1, S99]')).toBe('[S1][S99]');
  });
});
