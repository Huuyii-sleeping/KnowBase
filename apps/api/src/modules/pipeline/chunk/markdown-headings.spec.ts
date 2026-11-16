import { describe, expect, it } from 'vitest';
import { headingPathAt, markdownHeadings } from './markdown-headings';

describe('Markdown heading paths', () => {
  it('tracks nested paths and resets sibling and parent scopes at source lines', () => {
    const headings = markdownHeadings(
      'preamble\n# Root\n## First\n### Deep\nbody\n## Second ##\n# Other',
    );
    expect(headingPathAt(headings, 1)).toEqual([]);
    expect(headingPathAt(headings, 5)).toEqual(['Root', 'First', 'Deep']);
    expect(headingPathAt(headings, 6)).toEqual(['Root', 'Second']);
    expect(headingPathAt(headings, 7)).toEqual(['Other']);
  });

  it('ignores fenced examples, indented code and quoted headings', () => {
    const headings = markdownHeadings(
      '# Root\n```md\n# Fake\n```\n~~~\n## Fake too\n~~~\n    # Code\n> # Quote\n## Actual',
    );
    expect(headings.map((h) => h.path)).toEqual([['Root'], ['Root', 'Actual']]);
  });

  it('recognizes Setext headings and CRLF without treating a standalone rule as a heading', () => {
    const headings = markdownHeadings(
      'Root\r\n====\r\n\r\n---\r\nSection\r\n---\r\ntext',
    );
    expect(headings).toEqual([
      { line: 1, path: ['Root'] },
      { line: 5, path: ['Root', 'Section'] },
    ]);
    expect(markdownHeadings('')).toEqual([]);
  });
});
