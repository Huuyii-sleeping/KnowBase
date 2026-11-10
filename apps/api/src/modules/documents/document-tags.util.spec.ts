import { describe, expect, it } from 'vitest';
import { parseDocumentTags } from './document-tags.util';
describe('document tags', () => {
  it('accepts JSON arrays or comma-separated text', () => {
    expect(parseDocumentTags('[" a ", "", "b"]')).toEqual(['a', 'b']);
    expect(parseDocumentTags(' a, ,b ')).toEqual(['a', 'b']);
  });
  it('rejects structured non-arrays and empty values', () => {
    expect(parseDocumentTags('{}')).toEqual([]);
    expect(parseDocumentTags()).toEqual([]);
  });
});
