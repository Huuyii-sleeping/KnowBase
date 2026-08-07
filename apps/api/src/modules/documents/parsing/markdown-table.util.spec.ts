import { describe, expect, it } from 'vitest';
import { tableToMarkdown } from './markdown-table.util';

describe('tableToMarkdown', () => {
  it('renders a padded table and escapes pipes', () => {
    const result = tableToMarkdown([
      ['Name', 'Value'],
      ['A|B', '10'],
    ]);

    expect(result).toContain('| Name');
    expect(result).toContain('| A\\|B');
    expect(result).toContain('| -----');
  });
});
