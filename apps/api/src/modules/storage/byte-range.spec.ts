import { describe, expect, it } from 'vitest';
import { byteRange } from './byte-range';

describe('single byte ranges', () => {
  it.each([
    ['bytes=0-2', { start: 0, end: 2 }],
    ['bytes=5-', { start: 5, end: 9 }],
    ['bytes=-3', { start: 7, end: 9 }],
    ['bytes=-99', { start: 0, end: 9 }],
    ['bytes=8-100', { start: 8, end: 9 }],
  ])('parses %s', (header, result) =>
    expect(byteRange(header as string, 10)).toEqual(result),
  );
  it.each([
    'bytes=10-',
    'bytes=3-2',
    'bytes=-0',
    'bytes=-',
    'bytes=0-1,3-4',
    'items=1-2',
    'bytes=9007199254740992-',
  ])('rejects %s', (header) => expect(byteRange(header, 10)).toBeUndefined());
  it('rejects ranges on empty files', () =>
    expect(byteRange('bytes=0-', 0)).toBeUndefined());
});
