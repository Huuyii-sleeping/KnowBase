import { describe, expect, it } from 'vitest';
import { TextParser } from './text.parser';

describe('TextParser', () => {
  it('converts text input into a titled Markdown document', async () => {
    const result = await new TextParser().parse(
      Buffer.from('Hello world'),
      'notes.txt',
      { documentId: 'test', uploadAsset: async () => { throw new Error('not expected'); } },
    );

    expect(result.parser).toBe('text');
    expect(result.ready).toBe(true);
    expect(result.markdown).toContain('# notes');
    expect(result.markdown).toContain('Hello world');
  });
});
