import { describe, expect, it } from 'vitest';
import { decodeText } from './decode-text';
describe('text decoding', () => {
  it('normalizes UTF-8 and BOM-marked UTF-16 without corrupting Chinese', () => {
    expect(decodeText(Buffer.from('\ufeff中文\r\n正文'))).toBe('中文\n正文');
    expect(
      decodeText(
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from('中文', 'utf16le'),
        ]),
      ),
    ).toBe('中文');
    expect(decodeText(Buffer.from([0xfe, 0xff, 0x4e, 0x2d]))).toBe('中');
  });
  it.each([
    Buffer.from([0xff, 0x80]),
    Buffer.from(' \r\n'),
    Buffer.from('binary\0data'),
  ])('rejects unsupported or empty text', (input) => {
    expect(() => decodeText(input)).toThrow();
  });
});
