import { describe, expect, it } from 'vitest';
import { htmlTableEnd } from './html-table-boundary';
import { TABLE_LIMITS } from './table.types';

describe('bounded HTML table boundary', () => {
  it('returns the actual UTF-16 boundary before trailing text', () => {
    const table = ' <TABLE><tr><td>😀<!-- </table> --></td></tr></TABLE>';
    expect(htmlTableEnd(table + 'after')).toBe(table.length);
  });

  it('requires an explicit closing table tag within the source budget', () => {
    expect(() => htmlTableEnd('<table><tr><td>x')).toThrow('Unclosed');
    expect(() =>
      htmlTableEnd(
        '<table><tr><td>' +
          'x'.repeat(TABLE_LIMITS.maxCharacters) +
          '</td></tr></table>',
      ),
    ).toThrow('budget');
  });
});
